/**
 * AUDIT 2026-08 — CrowdfundingV1 (Solidity) escrow trust, now inverted.
 *
 * These started life as proofs of concept for three findings and asserted the
 * broken behaviour. They now assert that the fixes hold:
 *
 * N-1  `activate(_splitter)` used to send the ENTIRE escrow to any non-zero
 *      address the admin named at call time — no proposal, no delay, no check
 *      that the target was even a contract. It is now a two-step, timelocked
 *      operation against a probed address.
 *
 * N-2  A Succeeded campaign that was never activated locked the escrow forever
 *      (`refund` only opens on Failed). `expireActivation` is now a
 *      permissionless escape hatch once the activation window closes.
 *
 * N-3  `contribute` credited the nominal price regardless of what the payment
 *      token actually delivered. Fee-on-transfer tokens are now rejected.
 */
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { deployExternalToken } from "../utils/deploys";

const parseEther = ethers.utils.parseEther;

async function now(): Promise<number> {
    return (await ethers.provider.getBlock("latest")).timestamp;
}
async function increaseTime(s: number) {
    await ethers.provider.send("evm_increaseTime", [s]);
    await ethers.provider.send("evm_mine", []);
}

const DAY = 24 * 3600;
const TIMELOCK = 7 * DAY;
const ACTIVATION_WINDOW = 90 * DAY;

describe("AUDIT 2026-08 / CrowdfundingV1 escrow trust", function () {
    let admin: SignerWithAddress;
    let inv1: SignerWithAddress;
    let inv2: SignerWithAddress;
    let attackerWallet: SignerWithAddress;
    let token: Contract;
    let cf: Contract;
    let poolLike: Contract;

    const PRICE = parseEther("1");
    const SOFT = 100;
    const HARD = 1000;
    const DEADLINE_OFFSET = 1000;

    // These tests fast-forward the chain (up to a year). Hardhat shares one
    // in-memory node across the whole run, so without snapshot/revert the clock
    // drift would break every later suite that derives dates from Date.now().
    let snapshotId: string;

    afterEach(async function () {
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    beforeEach(async function () {
        snapshotId = await ethers.provider.send("evm_snapshot", []);
        const accounts = await ethers.getSigners();
        admin = accounts[0];
        inv1 = accounts[1];
        inv2 = accounts[2];
        attackerWallet = accounts[8];

        token = await deployExternalToken(
            admin, "USD Coin", "USDC", parseEther("1000000").toString()
        );
        for (const inv of [inv1, inv2]) {
            await token.connect(admin).functions.transfer(inv.address, parseEther("10000"));
        }

        // Something that answers getParticipationToken(), i.e. what the
        // activation probe accepts as a distribution pool.
        const Mock = await ethers.getContractFactory("MockSplitter");
        poolLike = await Mock.connect(admin).deploy(token.address);
        await poolLike.deployed();

        const CF = await ethers.getContractFactory("CrowdfundingV1");
        cf = await CF.connect(admin).deploy(
            admin.address, token.address, PRICE, SOFT, HARD,
            (await now()) + DEADLINE_OFFSET
        );
        await cf.deployed();

        for (const inv of [inv1, inv2]) {
            await token.connect(inv).functions.approve(cf.address, parseEther("1000000"));
        }

        // a successful campaign: 200 shares sold against a soft cap of 100
        await cf.connect(inv1).functions.contribute(120);
        await cf.connect(inv2).functions.contribute(80);
        await increaseTime(DEADLINE_OFFSET + 1);
        await cf.connect(inv1).functions.finalize();
        expect((await cf.functions.status())[0]).to.equal(1); // Succeeded
    });

    it("N-1: the escrow can no longer be sent anywhere on a whim", async function () {
        const raised = (await cf.functions.totalRaised())[0];
        expect(raised).to.equal(PRICE.mul(200));
        expect((await token.functions.balanceOf(cf.address))[0]).to.equal(raised);

        // A plain EOA is not a splitter and is now rejected outright.
        await expect(
            cf.connect(admin).functions.proposeActivation(attackerWallet.address)
        ).to.be.revertedWithCustomError(cf, "InvalidSplitter");

        // Neither is the campaign itself, the payment token, or the admin.
        for (const bad of [cf.address, token.address, admin.address]) {
            await expect(
                cf.connect(admin).functions.proposeActivation(bad)
            ).to.be.revertedWithCustomError(cf, "InvalidSplitter");
        }

        // Activation without a standing proposal is refused.
        await expect(
            cf.connect(admin).functions.activate(poolLike.address)
        ).to.be.revertedWithCustomError(cf, "NoPendingActivation");

        // The honest path: announce, wait, execute.
        await cf.connect(admin).functions.proposeActivation(poolLike.address);
        const [pending, eta] = await cf.functions.getPendingActivation();
        expect(pending).to.equal(poolLike.address);
        expect(eta.toNumber()).to.be.greaterThan(await now());

        // Not a second early, and not to a different address than announced.
        await expect(
            cf.connect(admin).functions.activate(poolLike.address)
        ).to.be.revertedWithCustomError(cf, "ActivationTimelockPending");
        await increaseTime(TIMELOCK + 1);
        await expect(
            cf.connect(admin).functions.activate(attackerWallet.address)
        ).to.be.revertedWithCustomError(cf, "SplitterMismatch");

        await cf.connect(admin).functions.activate(poolLike.address);
        expect((await token.functions.balanceOf(poolLike.address))[0]).to.equal(raised);
        expect((await token.functions.balanceOf(cf.address))[0]).to.equal(0);
        expect((await cf.functions.status())[0]).to.equal(3); // Activated
    });

    it("N-1: only the admin can propose, and a proposal can be withdrawn", async function () {
        await expect(
            cf.connect(inv1).functions.proposeActivation(poolLike.address)
        ).to.be.revertedWithCustomError(cf, "OnlyAdmin");

        await cf.connect(admin).functions.proposeActivation(poolLike.address);
        await cf.connect(admin).functions.cancelActivation();
        expect((await cf.functions.getPendingActivation())[0])
            .to.equal(ethers.constants.AddressZero);

        await increaseTime(TIMELOCK + 1);
        await expect(
            cf.connect(admin).functions.activate(poolLike.address)
        ).to.be.revertedWithCustomError(cf, "NoPendingActivation");
    });

    it("N-2: an abandoned Succeeded campaign returns the money to investors", async function () {
        const raised = (await cf.functions.totalRaised())[0];

        // Still inside the activation window: the hatch stays shut.
        await increaseTime(30 * DAY);
        await expect(
            cf.connect(inv1).functions.expireActivation()
        ).to.be.revertedWithCustomError(cf, "ActivationWindowStillOpen");
        await expect(
            cf.connect(inv1).functions.refund()
        ).to.be.revertedWithCustomError(cf, "NotFailed");

        // Once it closes, anyone — not just the admin — can open refunds.
        await increaseTime(ACTIVATION_WINDOW);
        await cf.connect(inv2).functions.expireActivation();
        expect((await cf.functions.status())[0]).to.equal(2); // Failed

        const b1 = (await token.functions.balanceOf(inv1.address))[0];
        await cf.connect(inv1).functions.refund();
        expect((await token.functions.balanceOf(inv1.address))[0].sub(b1))
            .to.equal(PRICE.mul(120));

        const b2 = (await token.functions.balanceOf(inv2.address))[0];
        await cf.connect(inv2).functions.refund();
        expect((await token.functions.balanceOf(inv2.address))[0].sub(b2))
            .to.equal(PRICE.mul(80));

        // Every cent left, and nobody can refund twice.
        expect((await token.functions.balanceOf(cf.address))[0]).to.equal(0);
        expect(raised).to.equal(PRICE.mul(200));
        await expect(
            cf.connect(inv1).functions.refund()
        ).to.be.revertedWithCustomError(cf, "NothingToRefund");
    });

    it("N-2: expiry cannot undo a completed activation", async function () {
        await cf.connect(admin).functions.proposeActivation(poolLike.address);
        await increaseTime(TIMELOCK + 1);
        await cf.connect(admin).functions.activate(poolLike.address);

        await increaseTime(ACTIVATION_WINDOW);
        await expect(
            cf.connect(inv1).functions.expireActivation()
        ).to.be.revertedWithCustomError(cf, "NotSucceeded");
    });

    it("N-2: activation cannot race past the refund window", async function () {
        await cf.connect(admin).functions.proposeActivation(poolLike.address);
        await increaseTime(ACTIVATION_WINDOW + DAY);

        await expect(
            cf.connect(admin).functions.activate(poolLike.address)
        ).to.be.revertedWithCustomError(cf, "ActivationWindowExpired");
    });

    it("N-1: an investor can leave while the notice is running, and that withdraws the proposal", async function () {
        await cf.connect(admin).functions.proposeActivation(poolLike.address);

        const before = (await token.functions.balanceOf(inv1.address))[0];
        await cf.connect(inv1).functions.optOut();

        // inv1 paid 120 * PRICE and gets exactly that back.
        expect((await token.functions.balanceOf(inv1.address))[0].sub(before))
            .to.equal(PRICE.mul(120));
        expect((await cf.functions.contributions(inv1.address))[0]).to.equal(0);

        // The campaign shrank, and the escrow still matches the books.
        expect((await cf.functions.totalRaised())[0]).to.equal(PRICE.mul(80));
        expect((await token.functions.balanceOf(cf.address))[0]).to.equal(PRICE.mul(80));
        expect((await cf.functions.totalSharesSold())[0]).to.equal(80);

        // The proposal is gone: the admin cannot activate against the stale cap
        // table it built before inv1 walked out.
        expect((await cf.functions.getPendingActivation())[0])
            .to.equal(ethers.constants.AddressZero);
        await increaseTime(TIMELOCK + 1);
        await expect(
            cf.connect(admin).functions.activate(poolLike.address)
        ).to.be.revertedWithCustomError(cf, "NoPendingActivation");

        // A fresh proposal serves a fresh notice, and only the remaining money
        // ever moves.
        await cf.connect(admin).functions.proposeActivation(poolLike.address);
        await expect(
            cf.connect(admin).functions.activate(poolLike.address)
        ).to.be.revertedWithCustomError(cf, "ActivationTimelockPending");
        await increaseTime(TIMELOCK + 1);
        await cf.connect(admin).functions.activate(poolLike.address);
        expect((await token.functions.balanceOf(poolLike.address))[0]).to.equal(PRICE.mul(80));
        expect((await token.functions.balanceOf(cf.address))[0]).to.equal(0);
    });

    it("N-1: leaving is only possible while a notice is actually running", async function () {
        // No proposal yet.
        await expect(
            cf.connect(inv1).functions.optOut()
        ).to.be.revertedWithCustomError(cf, "NoPendingActivation");

        await cf.connect(admin).functions.proposeActivation(poolLike.address);

        // A non-contributor has nothing to take back, and cannot use the call
        // to reset the notice on everyone else's behalf.
        await expect(
            cf.connect(attackerWallet).functions.optOut()
        ).to.be.revertedWithCustomError(cf, "NothingToRefund");
        expect((await cf.functions.getPendingActivation())[0]).to.equal(poolLike.address);

        // Once the notice elapses the admin may act, so the exit closes.
        await increaseTime(TIMELOCK + 1);
        await expect(
            cf.connect(inv1).functions.optOut()
        ).to.be.revertedWithCustomError(cf, "NoticePeriodOver");

        // And after activation there is nothing left to leave.
        await cf.connect(admin).functions.activate(poolLike.address);
        await expect(
            cf.connect(inv1).functions.optOut()
        ).to.be.revertedWithCustomError(cf, "AlreadyActivated");
    });

    it("N-3: a fee-on-transfer payment token is rejected at contribution", async function () {
        const Fee = await ethers.getContractFactory("FeeOnTransferToken");
        const feeToken = await Fee.connect(admin).deploy(parseEther("1000000"));
        await feeToken.deployed();
        await feeToken.connect(admin).functions.transfer(inv1.address, parseEther("10000"));

        const CF = await ethers.getContractFactory("CrowdfundingV1");
        const cf2 = await CF.connect(admin).deploy(
            admin.address, feeToken.address, PRICE, SOFT, HARD,
            (await now()) + DEADLINE_OFFSET
        );
        await cf2.deployed();
        await feeToken.connect(inv1).functions.approve(cf2.address, parseEther("1000000"));

        await expect(
            cf2.connect(inv1).functions.contribute(10)
        ).to.be.revertedWithCustomError(cf2, "PaymentTokenNotSupported");
    });
});
