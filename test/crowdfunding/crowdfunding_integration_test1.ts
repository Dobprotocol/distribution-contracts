import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { deployStorage, deployPoolLogic, deployPoolMaster, deployExternalToken, deployRewardPool } from "../utils/deploys";

const parseEther = ethers.utils.parseEther;
async function nowTs(): Promise<number> { return (await ethers.provider.getBlock("latest")).timestamp; }
async function increaseTime(s: number) { await ethers.provider.send("evm_increaseTime", [s]); await ethers.provider.send("evm_mine", []); }

// Full crowdfunding -> splitter -> claim integration:
//   factory creates campaign -> investors contribute (escrow) -> finalize Succeeded
//   -> deploy a V2 pool whose shares == contributions -> cf.activate(pool) moves
//   the escrowed funds to the pool -> createDistribution -> each investor claims
//   their pro-rata (== their contribution share).
describe("Crowdfunding integration — campaign success funds a V2 splitter, investors claim", function () {
    let accounts: SignerWithAddress[];
    let creator: SignerWithAddress, operational: SignerWithAddress, admin: SignerWithAddress;
    let inv1: SignerWithAddress, inv2: SignerWithAddress, stranger: SignerWithAddress;
    let _storage: Contract, _pm: Contract, _pmc: Contract, _v2: Contract;
    let token: Contract, factory: Contract;

    const PRICE = parseEther("1");
    const SOFT = 100, HARD = 1000;

    // This suite moves the clock (campaign deadlines, the 90-day activation
    // window). Hardhat shares one in-memory node across the whole run — put the
    // clock back afterwards.
    let snapshotId: string;

    afterEach(async function () {
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    beforeEach(async function () {
        snapshotId = await ethers.provider.send("evm_snapshot", []);
        accounts = await ethers.getSigners();
        creator = accounts[0]; operational = accounts[1]; admin = accounts[2];
        inv1 = accounts[3]; inv2 = accounts[4]; stranger = accounts[10];

        _storage = await deployStorage(creator);
        [_pm, _pmc] = await deployPoolMaster(creator, _storage);
        _v2 = await deployPoolLogic(_storage, creator, "DistributionPoolV2");
        await _pmc.connect(creator).functions.initialize(1, 1, 1, operational.address, 300);
        await _pm.connect(creator).functions.initialize(_pmc.address);
        await _pmc.connect(creator).functions.addLogicVersion(_v2.address, 1, "DistributionPoolV2");
        await _pm.connect(creator).functions.createPoolMasterTreasuryPool([operational.address], [100], "");

        token = await deployExternalToken(creator, "USD Coin", "USDC", parseEther("1000000").toString());
        await token.connect(creator).functions.transfer(inv1.address, parseEther("10000"));
        await token.connect(creator).functions.transfer(inv2.address, parseEther("10000"));

        const F = await ethers.getContractFactory("CrowdfundingFactory");
        factory = await F.connect(creator).deploy();
        await factory.deployed();
    });

    it("end-to-end: contribute -> finalize -> activate to V2 pool -> claim pro-rata", async function () {
        // 1. create campaign via factory (admin is the campaign admin)
        const deadline = (await nowTs()) + 1000;
        const tx = await factory.connect(admin).functions.createCampaign(token.address, PRICE, SOFT, HARD, deadline);
        const rc = await tx.wait();
        const ev = rc.events.find((e: any) => e.event === "CrowdfundingCreated");
        const cf = await ethers.getContractAt("CrowdfundingV1", ev.args.campaign);

        // 2. investors contribute (60 + 40 = 100 shares == soft cap)
        await token.connect(inv1).functions.approve(cf.address, parseEther("1000000"));
        await token.connect(inv2).functions.approve(cf.address, parseEther("1000000"));
        await cf.connect(inv1).functions.contribute(60);
        await cf.connect(inv2).functions.contribute(40);

        // 3. finalize after deadline -> Succeeded
        await increaseTime(1001);
        await cf.functions.finalize();
        expect((await cf.functions.status())[0]).to.equal(1);
        const raised = PRICE.mul(100);
        expect((await cf.functions.totalRaised())[0]).to.equal(raised);

        // 4. deploy a V2 pool whose shares mirror the contributions
        const pool = await deployRewardPool(
            _pm, _pmc, admin, [inv1.address, inv2.address], [60, 40], 0
        );

        // 5. admin announces the destination, then activates it -> escrowed
        //    funds move to the pool (AUDIT 2026-08 / N-1). ACTIVATION_TIMELOCK
        //    is zero, so the two steps may land in consecutive blocks; the
        //    announcement is the audit record, not a mandatory wait.
        await cf.connect(admin).functions.proposeActivation(pool.address);
        await cf.connect(admin).functions.activate(pool.address);
        expect((await cf.functions.status())[0]).to.equal(3); // Activated
        expect((await token.functions.balanceOf(pool.address))[0]).to.equal(raised);

        // 6. register the payment token + create the distribution round
        await pool.connect(admin).functions.addExternalToken(token.address);
        await (await pool.connect(admin).functions.createDistribution(token.address)).wait();

        // 7. each investor claims their pro-rata (commission 0.5%)
        const totalAmount = raised.mul(9950).div(10000);
        const before1 = (await token.functions.balanceOf(inv1.address))[0];
        await pool.connect(stranger).functions.claim(inv1.address, token.address, 0);
        const after1 = (await token.functions.balanceOf(inv1.address))[0];
        expect(after1.sub(before1)).to.equal(totalAmount.mul(60).div(100));

        const before2 = (await token.functions.balanceOf(inv2.address))[0];
        await pool.connect(stranger).functions.claim(inv2.address, token.address, 0);
        const after2 = (await token.functions.balanceOf(inv2.address))[0];
        expect(after2.sub(before2)).to.equal(totalAmount.mul(40).div(100));
    });

    it("factory tracks campaigns", async function () {
        const deadline = (await nowTs()) + 1000;
        await factory.connect(admin).functions.createCampaign(token.address, PRICE, SOFT, HARD, deadline);
        await factory.connect(admin).functions.createCampaign(token.address, PRICE, SOFT, HARD, deadline);
        expect((await factory.functions.campaignsCount())[0]).to.equal(2);
        expect((await factory.functions.getCampaignsByAdmin(admin.address))[0].length).to.equal(2);
    });
});
