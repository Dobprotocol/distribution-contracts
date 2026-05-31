import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { deployStorage, deployPoolLogic, deployPoolMaster, deployParticipationPool } from "../utils/deploys";

const AddressZero = ethers.constants.AddressZero;
const parseEther = ethers.utils.parseEther;

async function increaseTime(s: number) {
    await ethers.provider.send("evm_increaseTime", [s]);
    await ethers.provider.send("evm_mine", []);
}

// Regression test for the C1 finding: claims must be computed from a per-holder
// balance SNAPSHOT taken at round creation, NOT the live balance. Otherwise a
// holder could claim a round, transfer their shares to a fresh address, and
// claim the same round again (and again) to drain the pool.
describe("DistributionPoolV2 — snapshot prevents re-claim via share transfer", function () {
    let accounts: SignerWithAddress[];
    let creator: SignerWithAddress, operational: SignerWithAddress, poolOwner: SignerWithAddress, stranger: SignerWithAddress;
    let _storage: Contract, _pm: Contract, _pmc: Contract, _v2: Contract, pool: Contract, ptoken: Contract;
    let poolUsers: string[];
    const SHARES = [86, 59, 54]; // acct2, acct3, acct4 ; supply 199

    beforeEach(async function () {
        accounts = await ethers.getSigners();
        creator = accounts[0]; operational = accounts[1]; poolOwner = accounts[2]; stranger = accounts[10];
        poolUsers = [accounts[2].address, accounts[3].address, accounts[4].address];

        _storage = await deployStorage(creator);
        [_pm, _pmc] = await deployPoolMaster(creator, _storage);
        _v2 = await deployPoolLogic(_storage, creator, "DistributionPoolV2");
        await _pmc.connect(creator).functions.initialize(1, 1, 1, operational.address, 300);
        await _pm.connect(creator).functions.initialize(_pmc.address);
        await _pmc.connect(creator).functions.addLogicVersion(_v2.address, 1, "DistributionPoolV2");
        await _pm.connect(creator).functions.createPoolMasterTreasuryPool([operational.address], [100], "");

        pool = await deployParticipationPool(_pm, _pmc, poolOwner, poolUsers, SHARES, Math.floor(Date.now() / 1000) - 100000, 999, 20000);
        const ptAddr = (await pool.functions.getParticipationToken())[0];
        ptoken = await ethers.getContractAt("ParticipationToken", ptAddr);
    });

    it("a fresh address that receives shares AFTER a round cannot claim that round", async function () {
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();

        // acct3 (59 shares) claims round 0 legitimately
        await pool.connect(stranger).functions.claim(poolUsers[1], AddressZero, 0);
        expect((await pool.functions.hasClaimed(poolUsers[1], AddressZero, 0))[0]).to.equal(true);

        // attacker moves the 59 shares to a fresh address (accounts[5])
        const fresh = accounts[5].address;
        await ptoken.connect(accounts[3]).functions.transfer(fresh, 59);
        expect((await ptoken.functions.balanceOf(fresh))[0]).to.equal(59);

        // the fresh address has 59 shares NOW, but had 0 at the round-0 snapshot
        expect((await pool.functions.getClaimable(fresh, AddressZero, 0))[0]).to.equal(0);
        // ...so claiming round 0 from it must revert (no re-claim / no drain)
        await expect(
            pool.connect(stranger).functions.claim(fresh, AddressZero, 0)
        ).to.be.revertedWithCustomError(pool, "NothingToClaim");
    });

    it("a NEW round after the transfer correctly reflects the new holder", async function () {
        // round 0
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();

        // move acct3's 59 shares to fresh address, then open a new round
        const fresh = accounts[5].address;
        await ptoken.connect(accounts[3]).functions.transfer(fresh, 59);
        await increaseTime(12 * 60 * 60 + 1); // clear the 12h time-gate
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();

        // round 1 snapshot has fresh=59, acct3=0
        const r1 = await pool.functions.getRound(AddressZero, 1);
        const expectFresh = r1.totalAmount.mul(59).div(199);
        expect((await pool.functions.getClaimable(fresh, AddressZero, 1))[0]).to.equal(expectFresh);
        expect((await pool.functions.getClaimable(poolUsers[1], AddressZero, 1))[0]).to.equal(0);

        await pool.connect(stranger).functions.claim(fresh, AddressZero, 1);
        expect((await pool.functions.hasClaimed(fresh, AddressZero, 1))[0]).to.equal(true);
    });
});
