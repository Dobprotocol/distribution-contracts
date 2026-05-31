import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { expect } from "chai";
import { deployStorage, deployPoolLogic, deployPoolMaster, deployRewardPool } from "../utils/deploys";

const AddressZero = ethers.constants.AddressZero;
const parseEther = ethers.utils.parseEther;

// Proves the real-world 100k-holder model: holders are NOT minted at creation
// (only a small initial allocation); they accumulate by RECEIVING shares
// (buying/transfer), each an O(1) tx. Distribution then snapshots ALL current
// holders and each claims pro-rata. createDistribution gas stays flat.
describe("DistributionPoolV2 — scale via organic holder growth (100k-ready)", function () {
    let accounts: SignerWithAddress[];
    let creator: SignerWithAddress, operational: SignerWithAddress, owner: SignerWithAddress;
    let _storage: Contract, _pm: Contract, _pmc: Contract, _v2: Contract;

    beforeEach(async function () {
        accounts = await ethers.getSigners();
        creator = accounts[0]; operational = accounts[1]; owner = accounts[2];
        _storage = await deployStorage(creator);
        [_pm, _pmc] = await deployPoolMaster(creator, _storage);
        _v2 = await deployPoolLogic(_storage, creator, "DistributionPoolV2");
        // high sharesLimit so total supply can accommodate many holders (>=1 share each)
        await _pmc.connect(creator).functions.initialize(1, 1, 1, operational.address, 1_000_000);
        await _pm.connect(creator).functions.initialize(_pmc.address);
        await _pmc.connect(creator).functions.setSharesLimit(1000000);
        await _pmc.connect(creator).functions.addLogicVersion(_v2.address, 1, "DistributionPoolV2");
        await _pm.connect(creator).functions.createPoolMasterTreasuryPool([operational.address], [100], "");
    });

    it("holders acquired AFTER creation (via transfer) are included and claim correctly", async function () {
        // small initial mint: owner holds 1000 shares (the realistic case)
        const INITIAL = 1000;
        const pool = await deployRewardPool(_pm, _pmc, owner, [owner.address], [INITIAL], 0, '{"name":"scale"}', parseEther("0.05").toString());
        const ptAddr = (await pool.functions.getParticipationToken())[0];
        const ptoken = await ethers.getContractAt("ParticipationToken", ptAddr);

        // simulate "buyers": owner transfers 10 shares to each of N fresh addresses
        // (each transfer is its own O(1) tx — exactly how holders grow in production)
        const N = 40;
        const buyers: string[] = [];
        for (let i = 0; i < N; i++) {
            const w = ethers.Wallet.createRandom().address;
            buyers.push(w);
            await ptoken.connect(owner).functions.transfer(w, 10);
        }
        // owner now has 1000 - 40*10 = 600 shares; 40 holders with 10 each; supply still 1000
        expect((await ptoken.functions.totalSupply())[0]).to.equal(INITIAL);
        expect((await ptoken.functions.balanceOf(owner.address))[0]).to.equal(INITIAL - N * 10);

        // distribute
        await pool.connect(accounts[10]).functions.deposit({ value: parseEther("1") });
        const tx = await pool.connect(owner).functions.createDistribution(AddressZero);
        const rc = await tx.wait();
        console.log("createDistribution gas with", N, "post-creation holders:", rc.gasUsed.toString());

        const r = await pool.functions.getRound(AddressZero, 0);
        const totalAmount = r.totalAmount;

        // a buyer (received shares AFTER creation) claims their 10/1000 pro-rata
        const buyer = buyers[7];
        const expectBuyer = totalAmount.mul(10).div(INITIAL);
        expect((await pool.functions.getClaimable(buyer, AddressZero, 0))[0]).to.equal(expectBuyer);
        const before = await ethers.provider.getBalance(buyer);
        await pool.connect(accounts[10]).functions.claim(buyer, AddressZero, 0);
        expect((await ethers.provider.getBalance(buyer)).sub(before)).to.equal(expectBuyer);

        // owner claims their 600/1000
        const beforeO = await ethers.provider.getBalance(owner.address);
        await pool.connect(accounts[10]).functions.claim(owner.address, AddressZero, 0);
        expect((await ethers.provider.getBalance(owner.address)).sub(beforeO)).to.equal(totalAmount.mul(INITIAL - N * 10).div(INITIAL));
    });

    it("createDistribution gas is independent of holder count (O(1) → 100k-ready)", async function () {
        // pool A: 1 holder ; pool B: owner spreads shares to 80 holders
        const poolA = await deployRewardPool(_pm, _pmc, owner, [owner.address], [1000], 0, '{"name":"A"}', parseEther("0.05").toString());
        await poolA.connect(accounts[10]).functions.deposit({ value: parseEther("1") });
        const gA = (await (await poolA.connect(owner).functions.createDistribution(AddressZero)).wait()).gasUsed.toNumber();

        const poolB = await deployRewardPool(_pm, _pmc, owner, [owner.address], [1000], 0, '{"name":"B"}', parseEther("0.05").toString());
        const ptB = await ethers.getContractAt("ParticipationToken", (await poolB.functions.getParticipationToken())[0]);
        for (let i = 0; i < 80; i++) await ptB.connect(owner).functions.transfer(ethers.Wallet.createRandom().address, 5);
        await poolB.connect(accounts[10]).functions.deposit({ value: parseEther("1") });
        const gB = (await (await poolB.connect(owner).functions.createDistribution(AddressZero)).wait()).gasUsed.toNumber();

        console.log(`createDistribution gas — 1 holder: ${gA}, 80+ holders: ${gB}`);
        expect(Math.abs(gB - gA)).to.be.lessThan(5000); // flat ⇒ scales to 100k
    });
});
