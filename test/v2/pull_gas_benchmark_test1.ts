import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { expect } from "chai";
import { deployStorage, deployPoolLogic, deployPoolMaster, deployParticipationPool } from "../utils/deploys";

const AddressZero = ethers.constants.AddressZero;
const parseEther = ethers.utils.parseEther;

/**
 * Proves the headline V2 benefit: O(1) distribution. The whole reason Base
 * pools were capped at a few hundred holders was the legacy push loop
 * (gas grows with holder count). With the lazy pull model, createDistribution
 * does NO per-holder work, so its gas is flat regardless of pool size — which
 * is what lets V2 pools scale to 10,000+ shareholders.
 */
describe("DistributionPoolV2 — O(1) gas benchmark", function () {
    let accounts: SignerWithAddress[];
    let creator: SignerWithAddress;
    let operational: SignerWithAddress;

    let _storage: Contract;
    let _pm: Contract;
    let _pmc: Contract;
    let _v2: Contract;

    async function createDistGas(poolUsers: string[], shares: number[]): Promise<number> {
        const owner = accounts[2];
        const pool = await deployParticipationPool(
            _pm, _pmc, owner, poolUsers, shares, Math.floor(Date.now() / 1000) - 100000, 999, 20000
        );
        await pool.connect(accounts[10]).functions.deposit({ value: parseEther("1") });
        const tx = await pool.connect(owner).functions.createDistribution(AddressZero);
        const rc = await tx.wait();
        return rc.gasUsed.toNumber();
    }

    beforeEach(async function () {
        accounts = await ethers.getSigners();
        creator = accounts[0];
        operational = accounts[1];

        _storage = await deployStorage(creator);
        [_pm, _pmc] = await deployPoolMaster(creator, _storage);
        _v2 = await deployPoolLogic(_storage, creator, "DistributionPoolV2");

        // sharesLimit raised to 10000 — the cap that V2 makes safe
        await _pmc.connect(creator).functions.initialize(1, 1, 1, operational.address, 10000);
        await _pm.connect(creator).functions.initialize(_pmc.address);
        await _pmc.connect(creator).functions.addLogicVersion(_v2.address, 1, "DistributionPoolV2");
        await _pm.connect(creator).functions.createPoolMasterTreasuryPool([operational.address], [100], "");
    });

    it("createDistribution gas is flat across a 3-holder vs a 250-holder pool", async function () {
        // small pool: 3 holders
        const smallUsers = [accounts[2].address, accounts[3].address, accounts[4].address];
        const smallShares = [86, 59, 54];
        const gasSmall = await createDistGas(smallUsers, smallShares);

        // large pool: 250 distinct holders, 1 share each
        const bigUsers: string[] = [];
        const bigShares: number[] = [];
        for (let i = 0; i < 250; i++) {
            bigUsers.push(ethers.Wallet.createRandom().address);
            bigShares.push(1);
        }
        const gasBig = await createDistGas(bigUsers, bigShares);

        console.log(`createDistribution gas — 3 holders: ${gasSmall}, 250 holders: ${gasBig}`);

        // O(1): the 80x larger pool must cost essentially the same to distribute.
        // Allow a tiny tolerance for storage-warmth variance, NOT linear growth.
        const delta = Math.abs(gasBig - gasSmall);
        expect(delta).to.be.lessThan(5000);
        // sanity: a push loop over 250 holders would add hundreds of thousands of gas
        expect(gasBig).to.be.lessThan(gasSmall + 20000);
    });
});
