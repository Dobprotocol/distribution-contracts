import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import {
    deployStorage,
    deployPoolLogic,
    deployPoolMaster,
    deployParticipationPool,
    deployExternalToken,
} from "../utils/deploys";

const AddressZero = ethers.constants.AddressZero;
const parseEther = ethers.utils.parseEther;

async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
}

// Minimum claim window a pool owner may configure (AUDIT 2026-08 / B-3).
const MIN_CLAIM_WINDOW = 30 * 24 * 3600;

// shares & pro-rata helpers: users [acct2, acct3, acct4] hold [86, 59, 54]
// (totalSupply 199). Commission default = 50 bps (0.5%).
const SHARES = [86, 59, 54];
const SUPPLY = 199;
function afterCommission(deposit: any) {
    return deposit.mul(10000 - 50).div(10000);
}
function proRata(totalAmount: any, share: number) {
    return totalAmount.mul(share).div(SUPPLY);
}

describe("DistributionPoolV2 — lazy pull-based distribution", function () {
    let accounts: SignerWithAddress[];
    let creator: SignerWithAddress;
    let operational: SignerWithAddress;
    let poolOwner: SignerWithAddress;
    let stranger: SignerWithAddress;
    let poolUsers: string[];

    let _storage: Contract;
    let _pm: Contract;
    let _pmc: Contract;
    let _v2: Contract;
    let pool: Contract;

    // This suite fast-forwards the chain by up to a month. Hardhat shares one
    // in-memory node across the whole run, so the clock has to be put back or
    // later suites that derive dates from Date.now() start failing.
    let snapshotId: string;

    afterEach(async function () {
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    beforeEach(async function () {
        snapshotId = await ethers.provider.send("evm_snapshot", []);
        accounts = await ethers.getSigners();
        creator = accounts[0];
        operational = accounts[1];
        poolOwner = accounts[2];
        stranger = accounts[10];
        poolUsers = [accounts[2].address, accounts[3].address, accounts[4].address];

        _storage = await deployStorage(creator);
        [_pm, _pmc] = await deployPoolMaster(creator, _storage);
        _v2 = await deployPoolLogic(_storage, creator, "DistributionPoolV2");

        await _pmc.connect(creator).functions.initialize(1, 1, 1, operational.address, 300);
        await _pm.connect(creator).functions.initialize(_pmc.address);
        await _pmc.connect(creator).functions.addLogicVersion(_v2.address, 1, "DistributionPoolV2");
        await _pm.connect(creator).functions.createPoolMasterTreasuryPool([operational.address], [100], "");

        // reward pool: poolOwner is owner; distributions are owner-gated
        const firstDistributionDate = Math.floor(Date.now() / 1000) - 100000;
        pool = await deployParticipationPool(
            _pm, _pmc, poolOwner, poolUsers, SHARES, firstDistributionDate, 999, 20000
        );
    });

    it("reports V2 version and the pool was created with V2 logic", async function () {
        const v = (await pool.functions.getPoolVersion())[0];
        expect(v).to.equal("3.0");
    });

    it("createDistribution snapshots the round (O(1)) and pro-rata claims pay out (native)", async function () {
        const deposit = parseEther("1");
        await pool.connect(stranger).functions.deposit({ value: deposit });

        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();

        expect((await pool.functions.getRoundCount(AddressZero))[0]).to.equal(1);

        const r = await pool.functions.getRound(AddressZero, 0);
        const totalAmount = afterCommission(deposit);
        expect(r.totalAmount).to.equal(totalAmount);
        expect(r.totalSupplySnapshot).to.equal(SUPPLY);
        expect(r.totalClaimed).to.equal(0);
        expect(r.reclaimed).to.equal(false);

        // claimable preview matches pro-rata for acct3 (59 shares)
        const expected3 = proRata(totalAmount, 59);
        expect((await pool.functions.getClaimable(poolUsers[1], AddressZero, 0))[0]).to.equal(expected3);

        // permissionless claim: stranger triggers, funds go to acct3
        const before = await ethers.provider.getBalance(poolUsers[1]);
        await pool.connect(stranger).functions.claim(poolUsers[1], AddressZero, 0);
        const after = await ethers.provider.getBalance(poolUsers[1]);
        expect(after.sub(before)).to.equal(expected3);

        // round bookkeeping updated, claimable now 0
        expect((await pool.functions.getClaimable(poolUsers[1], AddressZero, 0))[0]).to.equal(0);
        expect((await pool.functions.hasClaimed(poolUsers[1], AddressZero, 0))[0]).to.equal(true);
        const r2 = await pool.functions.getRound(AddressZero, 0);
        expect(r2.totalClaimed).to.equal(expected3);
    });

    it("prevents double claims", async function () {
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();
        await pool.connect(stranger).functions.claim(poolUsers[0], AddressZero, 0);
        await expect(
            pool.connect(stranger).functions.claim(poolUsers[0], AddressZero, 0)
        ).to.be.revertedWithCustomError(pool, "AlreadyClaimed");
    });

    it("reverts claims for non-existent rounds and zero-balance addresses", async function () {
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();
        await expect(
            pool.connect(stranger).functions.claim(poolUsers[0], AddressZero, 5)
        ).to.be.revertedWithCustomError(pool, "RoundNotFound");
        // accounts[7] holds no participation token
        await expect(
            pool.connect(stranger).functions.claim(accounts[7].address, AddressZero, 0)
        ).to.be.revertedWithCustomError(pool, "NothingToClaim");
    });

    it("enforces time-gating between distributions (12h default)", async function () {
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await expect(
            pool.connect(poolOwner).functions.createDistribution(AddressZero)
        ).to.be.revertedWithCustomError(pool, "DistributionTooSoon");
        await increaseTime(12 * 60 * 60 + 1);
        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();
        expect((await pool.functions.getRoundCount(AddressZero))[0]).to.equal(2);
    });

    it("respects the claim window (claimDelay)", async function () {
        // minInterval 0, claimDelay 1h, expiry 1y
        await pool.connect(poolOwner).functions.setDistributionConfig(0, 3600, 365 * 24 * 3600);
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();
        await expect(
            pool.connect(stranger).functions.claim(poolUsers[0], AddressZero, 0)
        ).to.be.revertedWithCustomError(pool, "ClaimWindowNotOpen");
        await increaseTime(3601);
        await pool.connect(stranger).functions.claim(poolUsers[0], AddressZero, 0);
        expect((await pool.functions.hasClaimed(poolUsers[0], AddressZero, 0))[0]).to.equal(true);
    });

    it("expires rounds and lets the admin reclaim the unclaimed remainder", async function () {
        // minInterval 0, claimDelay 0, expiry at the 30-day floor. A shorter
        // window is no longer configurable (AUDIT 2026-08 / B-3): it would let
        // the owner expire a round before holders could realistically claim and
        // then reclaim the remainder.
        await pool.connect(poolOwner).functions.setDistributionConfig(0, 0, MIN_CLAIM_WINDOW);
        const deposit = parseEther("1");
        await pool.connect(stranger).functions.deposit({ value: deposit });
        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();
        const totalAmount = afterCommission(deposit);

        // one user claims before expiry
        await pool.connect(stranger).functions.claim(poolUsers[0], AddressZero, 0);
        const claimed0 = proRata(totalAmount, 86);

        await increaseTime(MIN_CLAIM_WINDOW + 1);
        // claims now fail
        await expect(
            pool.connect(stranger).functions.claim(poolUsers[1], AddressZero, 0)
        ).to.be.revertedWithCustomError(pool, "RoundExpired");

        // admin reclaims remainder = totalAmount - claimed0
        const ownerBefore = await ethers.provider.getBalance(poolOwner.address);
        const tx = await pool.connect(operational).functions.reclaimExpiredRound(AddressZero, 0);
        await tx.wait();
        const ownerAfter = await ethers.provider.getBalance(poolOwner.address);
        // operational paid the gas, funds went to owner
        expect(ownerAfter.sub(ownerBefore)).to.equal(totalAmount.sub(claimed0));

        // double reclaim reverts
        await expect(
            pool.connect(operational).functions.reclaimExpiredRound(AddressZero, 0)
        ).to.be.revertedWithCustomError(pool, "AlreadyReclaimed");
    });

    it("disables the legacy push path", async function () {
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await expect(
            pool.connect(poolOwner).functions.distribute(poolUsers, AddressZero)
        ).to.be.revertedWithCustomError(pool, "PushDisabled");
    });

    it("only the commission recipient (treasury) can change the commission", async function () {
        await expect(
            pool.connect(poolOwner).functions.setDistributionCommission(100)
        ).to.be.revertedWithCustomError(pool, "OnlyCommissionRecipient");
    });

    it("distributes and claims an ERC20 token pro-rata", async function () {
        const ext = await deployExternalToken(creator, "USD Coin", "USDC", parseEther("1000000").toString());
        await pool.connect(poolOwner).functions.addExternalToken(ext.address);

        const deposit = parseEther("1000");
        await ext.connect(creator).functions.transfer(pool.address, deposit);

        await (await pool.connect(poolOwner).functions.createDistribution(ext.address)).wait();
        const totalAmount = afterCommission(deposit);
        const r = await pool.functions.getRound(ext.address, 0);
        expect(r.totalAmount).to.equal(totalAmount);
        expect(r.totalSupplySnapshot).to.equal(SUPPLY);

        const expected3 = proRata(totalAmount, 59);
        const before = (await ext.functions.balanceOf(poolUsers[1]))[0];
        await pool.connect(stranger).functions.claim(poolUsers[1], ext.address, 0);
        const after = (await ext.functions.balanceOf(poolUsers[1]))[0];
        expect(after.sub(before)).to.equal(expected3);
    });
});
