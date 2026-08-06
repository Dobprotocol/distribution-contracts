/**
 * AUDIT 2026-08 — regression tests for the DistributionPoolV2 / ParticipationToken
 * findings, asserting the FIXED behaviour.
 *
 * B-1  `createDistribution` was callable by anyone. Any stranger could burn the
 *      pool's undistributed balance into a round at a moment of their choosing,
 *      locking the owner's timing and paying the commission early. It is now
 *      owner-only unless the owner explicitly opts into public distribution.
 * B-2  The round's reserve, id and timestamp were written AFTER the external
 *      `snapshot()` call on the participation token. A token that re-enters saw
 *      the same unallocated balance twice and minted two rounds backed by one
 *      deposit. The writes now precede the external call.
 * B-3  `setDistributionConfig` only required `claimDelay < expiry`, so a
 *      one-second claim window was configurable and every round could be
 *      reclaimed by the owner before anyone could claim. A 30-day minimum claim
 *      window is now enforced, matching the Stellar splitter.
 * B-4  `_transferOut` ignored the boolean returned by `transfer`, so a
 *      non-standard ERC20 that reports failure was treated as a successful
 *      payout.
 * B-5  `ParticipationToken.snapshot()` was open to the world; snapshot spam
 *      forces an extra SSTORE on every holder's next transfer. Only the
 *      deployer and authorised pools may snapshot now.
 * B-6  The mint entry points were `initializer` and nothing else, so the entire
 *      cap table of a deployed-but-unminted token went to whoever called first.
 */
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
} from "../utils/deploys";

const AddressZero = ethers.constants.AddressZero;
const parseEther = ethers.utils.parseEther;
const DAY = 24 * 3600;

async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
}

describe("AUDIT 2026-08 / DistributionPoolV2 + ParticipationToken", function () {
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

    // Some of these tests jump a month ahead; Hardhat shares one in-memory node
    // across the run, so put the clock back afterwards.
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
        await _pm.connect(creator).functions.createPoolMasterTreasuryPool(
            [operational.address], [100], ""
        );

        pool = await deployParticipationPool(
            _pm, _pmc, poolOwner, poolUsers, [86, 59, 54], 0
        );
    });

    // ---------------------------------------------------------------- B-1

    it("B-1: only the owner can create a distribution", async function () {
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });

        await expect(
            pool.connect(stranger).functions.createDistribution(AddressZero)
        ).to.be.revertedWithCustomError(pool, "NotAuthorizedToDistribute");
        expect((await pool.functions.getRoundCount(AddressZero))[0]).to.equal(0);

        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();
        expect((await pool.functions.getRoundCount(AddressZero))[0]).to.equal(1);
    });

    it("B-1: the owner can opt into permissionless distribution, and only the owner can", async function () {
        expect((await pool.functions.isPublicDistribution())[0]).to.equal(false);
        await expect(
            pool.connect(stranger).functions.setPublicDistribution(true)
        ).to.be.rejected;

        await pool.connect(poolOwner).functions.setPublicDistribution(true);
        expect((await pool.functions.isPublicDistribution())[0]).to.equal(true);

        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await (await pool.connect(stranger).functions.createDistribution(AddressZero)).wait();
        expect((await pool.functions.getRoundCount(AddressZero))[0]).to.equal(1);

        // and the opt-in can be withdrawn again
        await pool.connect(poolOwner).functions.setPublicDistribution(false);
        await increaseTime(13 * 3600);
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await expect(
            pool.connect(stranger).functions.createDistribution(AddressZero)
        ).to.be.revertedWithCustomError(pool, "NotAuthorizedToDistribute");
    });

    // ---------------------------------------------------------------- B-2

    it("B-2: a participation token that re-enters cannot mint a second round from one deposit", async function () {
        // A pool built around an attacker-supplied participation token — the
        // PoolMaster path that only checks decimals and total supply.
        const Evil = await ethers.getContractFactory("ReentrantParticipationToken");
        const evil = await Evil.connect(stranger).deploy(poolUsers, [86, 59, 54]);
        await evil.deployed();

        const tx = await _pm.connect(poolOwner).functions.createRewardPool(
            poolUsers, [86, 59, 54], 0, '{"name":"evil"}', evil.address,
            { value: parseEther("0.1") }
        );
        const rc = await tx.wait();
        const ev = rc.events.find((e: any) => e.event === "CreatePool");
        const evilPoolAddress = ev.args.contractAddress;

        const evilPool = _v2.attach(evilPoolAddress);
        await evil.connect(stranger).setPool(evilPoolAddress);
        // The token is not the treasury's, so let it snapshot itself: the
        // reentrancy defence must not depend on the B-5 authorisation.
        await evil.connect(stranger).arm();

        // Public distribution is on, so the re-entrant call clears the B-1 gate
        // and has to be stopped by the ordering fix alone.
        await evilPool.connect(poolOwner).functions.setPublicDistribution(true);
        await evilPool.connect(stranger).functions.deposit({ value: parseEther("1") });

        await (await evilPool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();

        // The token did try, and failed.
        expect(await evil.reentered()).to.equal(true);
        expect(await evil.reentrantCallSucceeded()).to.equal(false);

        // Exactly one round exists, and it promises no more than the pool holds.
        expect((await evilPool.functions.getRoundCount(AddressZero))[0]).to.equal(1);
        const round = await evilPool.functions.getRound(AddressZero, 0);
        const poolBalance = await ethers.provider.getBalance(evilPoolAddress);
        expect(round[0].lte(poolBalance)).to.equal(true);
    });

    // ---------------------------------------------------------------- B-3

    it("B-3: a claim window shorter than 30 days cannot be configured", async function () {
        for (const [delay, expiry] of [
            [0, 1],                 // one-second window
            [0, 29 * DAY],          // just under the floor
            [29 * DAY, 30 * DAY],   // long expiry, but the window is the gap
            [30 * DAY, 30 * DAY],   // delay swallows the whole window
            [0, 0],                 // no expiry at all
        ]) {
            await expect(
                pool.connect(poolOwner).functions.setDistributionConfig(0, delay, expiry),
                `delay=${delay} expiry=${expiry}`
            ).to.be.revertedWithCustomError(pool, "ExpiryMustBePositive");
        }

        // exactly at the floor is accepted
        await pool.connect(poolOwner).functions.setDistributionConfig(0, 0, 30 * DAY);
        await pool.connect(poolOwner).functions.setDistributionConfig(0, DAY, 31 * DAY);
    });

    it("B-3: a round therefore stays claimable long enough to actually be claimed", async function () {
        await pool.connect(poolOwner).functions.setDistributionConfig(0, 0, 30 * DAY);
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();

        // 29 days later a holder can still claim — the owner cannot have
        // reclaimed the round out from under them.
        await increaseTime(29 * DAY);
        await expect(
            pool.connect(operational).functions.reclaimExpiredRound(AddressZero, 0)
        ).to.be.revertedWithCustomError(pool, "RoundNotExpired");
        await pool.connect(stranger).functions.claim(poolUsers[1], AddressZero, 0);
        expect((await pool.functions.hasClaimed(poolUsers[1], AddressZero, 0))[0]).to.equal(true);
    });

    // ---------------------------------------------------------------- B-4

    it("B-4: an ERC20 that returns false on transfer is not treated as paid", async function () {
        const Lying = await ethers.getContractFactory("LyingToken");
        const lying = await Lying.connect(stranger).deploy(parseEther("1000"));
        await lying.deployed();

        await pool.connect(poolOwner).functions.addExternalToken(lying.address);
        await lying.connect(stranger).fund(pool.address, parseEther("100"));
        expect(await lying.balanceOf(pool.address)).to.equal(parseEther("100"));

        // The commission payout inside createDistribution goes through
        // _transferOut; the lying token reports failure and the whole round
        // creation must fail with it rather than book a phantom payment.
        await expect(
            pool.connect(poolOwner).functions.createDistribution(lying.address)
        ).to.be.revertedWithCustomError(pool, "TransferFailed");
        expect((await pool.functions.getRoundCount(lying.address))[0]).to.equal(0);
    });

    // ---------------------------------------------------------------- B-5

    it("B-5: only the deployer and authorised pools can snapshot the participation token", async function () {
        const ptAddress = (await pool.functions.getParticipationToken())[0];
        const pt = await ethers.getContractAt("ParticipationToken", ptAddress);

        // PoolMaster deployed it, so PoolMaster is the deployer — nobody else.
        expect(await pt.deployer()).to.equal(_pm.address);
        await expect(
            pt.connect(stranger).snapshot()
        ).to.be.revertedWithCustomError(pt, "NotAuthorizedToSnapshot");
        await expect(
            pt.connect(poolOwner).snapshot()
        ).to.be.revertedWithCustomError(pt, "NotAuthorizedToSnapshot");
        await expect(
            pt.connect(stranger).authorizeSnapshotter(stranger.address)
        ).to.be.revertedWithCustomError(pt, "NotDeployer");

        // The pool was authorised at creation and still distributes fine.
        expect(await pt.snapshotter(pool.address)).to.equal(true);
        await pool.connect(stranger).functions.deposit({ value: parseEther("1") });
        await (await pool.connect(poolOwner).functions.createDistribution(AddressZero)).wait();
        expect((await pool.functions.getRoundCount(AddressZero))[0]).to.equal(1);
    });

    // ---------------------------------------------------------------- B-6

    it("B-6: a stranger cannot mint the cap table of a freshly deployed participation token", async function () {
        const PT = await ethers.getContractFactory("ParticipationToken");
        const pt = await PT.connect(poolOwner).deploy("Dob Participation Token", "PPT");
        await pt.deployed();

        await expect(
            pt.connect(stranger).mint_participants(199, poolUsers, [86, 59, 54], false)
        ).to.be.revertedWithCustomError(pt, "NotDeployer");
        await expect(
            pt.connect(stranger).mint_single_owner(199, stranger.address, false)
        ).to.be.revertedWithCustomError(pt, "NotDeployer");
        expect(await pt.totalSupply()).to.equal(0);

        // The deployer still can, exactly once.
        await pt.connect(poolOwner).mint_participants(199, poolUsers, [86, 59, 54], false);
        expect(await pt.totalSupply()).to.equal(199);
        await expect(
            pt.connect(poolOwner).mint_participants(199, poolUsers, [86, 59, 54], false)
        ).to.be.rejected;
    });
});
