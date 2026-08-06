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

describe("CrowdfundingV1 — escrow campaign (Stellar crowdfunding_v1 port)", function () {
    let accounts: SignerWithAddress[];
    let admin: SignerWithAddress, inv1: SignerWithAddress, inv2: SignerWithAddress;
    let token: Contract;
    let cf: Contract;
    let splitter: Contract;

    // Activation is timelocked (AUDIT 2026-08 / N-1), so this suite now jumps a
    // week ahead. Hardhat shares one in-memory node across the whole run, so the
    // clock has to be put back or later suites that derive dates from Date.now()
    // start failing.
    let snapshotId: string;
    const TIMELOCK = 7 * 24 * 3600;

    afterEach(async function () {
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    const PRICE = parseEther("1");   // 1 token per share
    const SOFT = 100;
    const HARD = 1000;

    async function deployCampaign(deadlineOffset = 1000): Promise<Contract> {
        const CF = await ethers.getContractFactory("CrowdfundingV1");
        const dl = (await now()) + deadlineOffset;
        const c = await CF.connect(admin).deploy(admin.address, token.address, PRICE, SOFT, HARD, dl);
        await c.deployed();
        return c;
    }

    beforeEach(async function () {
        snapshotId = await ethers.provider.send("evm_snapshot", []);
        accounts = await ethers.getSigners();
        admin = accounts[0]; inv1 = accounts[1]; inv2 = accounts[2];
        token = await deployExternalToken(admin, "USD Coin", "USDC", parseEther("1000000").toString());
        // The activation probe only accepts something that answers
        // getParticipationToken(), so the destination can no longer be an EOA.
        const Mock = await ethers.getContractFactory("MockSplitter");
        splitter = await Mock.connect(admin).deploy(token.address);
        await splitter.deployed();
        // fund investors and approve generously
        for (const inv of [inv1, inv2]) {
            await token.connect(admin).functions.transfer(inv.address, parseEther("10000"));
        }
        cf = await deployCampaign();
        for (const inv of [inv1, inv2]) {
            await token.connect(inv).functions.approve(cf.address, parseEther("1000000"));
        }
    });

    it("rejects bad construction params", async function () {
        const CF = await ethers.getContractFactory("CrowdfundingV1");
        const dl = (await now()) + 1000;
        await expect(CF.connect(admin).deploy(admin.address, token.address, 0, SOFT, HARD, dl)).to.be.revertedWithCustomError(CF, "InvalidPrice");
        await expect(CF.connect(admin).deploy(admin.address, token.address, PRICE, 0, HARD, dl)).to.be.revertedWithCustomError(CF, "InvalidCap");
        await expect(CF.connect(admin).deploy(admin.address, token.address, PRICE, SOFT, HARD, (await now()) - 1)).to.be.revertedWithCustomError(CF, "InvalidDeadline");
    });

    it("escrows contributions and tracks totals", async function () {
        const before = (await token.functions.balanceOf(cf.address))[0];
        await cf.connect(inv1).functions.contribute(60);
        await cf.connect(inv2).functions.contribute(50);
        expect((await cf.functions.totalSharesSold())[0]).to.equal(110);
        expect((await cf.functions.getContribution(inv1.address))[0]).to.equal(60);
        const after = (await token.functions.balanceOf(cf.address))[0];
        expect(after.sub(before)).to.equal(PRICE.mul(110)); // escrowed
    });

    it("enforces hard cap and deadline", async function () {
        await expect(cf.connect(inv1).functions.contribute(0)).to.be.revertedWithCustomError(cf, "InvalidSharesAmount");
        await expect(cf.connect(inv1).functions.contribute(HARD + 1)).to.be.revertedWithCustomError(cf, "HardCapReached");
        await increaseTime(1001);
        await expect(cf.connect(inv1).functions.contribute(10)).to.be.revertedWithCustomError(cf, "CampaignNotActive");
    });

    it("SUCCESS path: finalize Succeeded then admin activates to splitter", async function () {
        await cf.connect(inv1).functions.contribute(80);
        await cf.connect(inv2).functions.contribute(40); // total 120 >= soft 100
        await expect(cf.functions.finalize()).to.be.revertedWithCustomError(cf, "DeadlineNotReached");
        await increaseTime(1001);

        await cf.functions.finalize();
        expect((await cf.functions.status())[0]).to.equal(1); // Succeeded

        const raised = PRICE.mul(120);
        const splBefore = (await token.functions.balanceOf(splitter.address))[0];
        await expect(cf.connect(inv1).functions.proposeActivation(splitter.address)).to.be.revertedWithCustomError(cf, "OnlyAdmin");
        await cf.connect(admin).functions.proposeActivation(splitter.address);
        await increaseTime(TIMELOCK + 1);
        await expect(cf.connect(inv1).functions.activate(splitter.address)).to.be.revertedWithCustomError(cf, "OnlyAdmin");
        await cf.connect(admin).functions.activate(splitter.address);
        expect((await cf.functions.status())[0]).to.equal(3); // Activated
        const splAfter = (await token.functions.balanceOf(splitter.address))[0];
        expect(splAfter.sub(splBefore)).to.equal(raised);
        // can't activate twice / refund on success
        await expect(cf.connect(admin).functions.activate(splitter.address)).to.be.revertedWithCustomError(cf, "AlreadyActivated");
        await expect(cf.connect(inv1).functions.refund()).to.be.revertedWithCustomError(cf, "NotFailed");
    });

    it("FAILURE path: finalize Failed then investors refund", async function () {
        await cf.connect(inv1).functions.contribute(30); // total 30 < soft 100
        await increaseTime(1001);
        await cf.functions.finalize();
        expect((await cf.functions.status())[0]).to.equal(2); // Failed

        await expect(cf.connect(admin).functions.proposeActivation(splitter.address)).to.be.revertedWithCustomError(cf, "NotSucceeded");

        const before = (await token.functions.balanceOf(inv1.address))[0];
        await cf.connect(inv1).functions.refund();
        const after = (await token.functions.balanceOf(inv1.address))[0];
        expect(after.sub(before)).to.equal(PRICE.mul(30));
        // double refund / no contribution
        await expect(cf.connect(inv1).functions.refund()).to.be.revertedWithCustomError(cf, "NothingToRefund");
        await expect(cf.connect(inv2).functions.refund()).to.be.revertedWithCustomError(cf, "NothingToRefund");
    });
});
