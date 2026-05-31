// Fresh full-stack deploy + end-to-end of DistributionPoolV2 AND CrowdfundingV1
// on Base Sepolia (live), using the local deployer key (0x305D...).
//
//   npx hardhat run scripts/deploy_e2e_basesepolia.ts --network basesepolia
import { ethers } from "hardhat";
import fs from "fs";
import { deployStorage, deployPoolMaster, deployPoolLogic, deployExternalToken, deployRewardPool } from "../test/utils/deploys";

const AddressZero = ethers.constants.AddressZero;
const parseEther = ethers.utils.parseEther;
const DEAD = "0x000000000000000000000000000000000000dEaD";

async function ts(): Promise<number> { return (await ethers.provider.getBlock("latest")).timestamp; }
async function waitUntil(target: number) {
    while ((await ts()) < target) {
        console.log(`  ...waiting for deadline (now ${await ts()} < ${target})`);
        await new Promise((r) => setTimeout(r, 6000));
    }
}

async function main() {
    const [signer] = await ethers.getSigners();
    const bal = await signer.getBalance();
    console.log("deployer:", signer.address, "| balance:", ethers.utils.formatEther(bal), "ETH");

    // ---- 1. fresh stack ----
    console.log("\n[1] deploying stack (storage, pool master, V2 logic)...");
    const storage = await deployStorage(signer);
    const [pm, pmc] = await deployPoolMaster(signer, storage);
    const v2 = await deployPoolLogic(storage, signer, "DistributionPoolV2");
    await (await pmc.connect(signer).functions.initialize(1, 1, 1, signer.address, 10000)).wait();
    await (await pm.connect(signer).functions.initialize(pmc.address)).wait();
    await (await pmc.connect(signer).functions.addLogicVersion(v2.address, 1, "DistributionPoolV2")).wait();
    await (await pm.connect(signer).functions.createPoolMasterTreasuryPool([signer.address], [100], "")).wait();
    console.log("  storage:", storage.address, "| pmc:", pmc.address, "| pm:", pm.address, "| v2:", v2.address);

    const F = await ethers.getContractFactory("CrowdfundingFactory");
    const factory = await F.connect(signer).deploy();
    await factory.deployed();
    console.log("  CrowdfundingFactory:", factory.address);

    // ---- 2. V2 distribution E2E (native) ----
    console.log("\n[2] V2 distribution E2E...");
    const prepay = parseEther("0.0005");
    const pool = await deployRewardPool(pm, pmc, signer, [signer.address, DEAD], [70, 30], 0, '{"name":"BaseSepolia V2 E2E"}', prepay.toString());
    console.log("  pool:", pool.address, "| version:", (await pool.functions.getPoolVersion())[0]);
    await (await pool.connect(signer).functions.deposit({ value: parseEther("0.001") })).wait();
    await (await pool.connect(signer).functions.createDistribution(AddressZero)).wait();
    const r = await pool.functions.getRound(AddressZero, 0);
    const expect70 = r.totalAmount.mul(70).div(100);
    const claimable = (await pool.functions.getClaimable(signer.address, AddressZero, 0))[0];
    await (await pool.connect(signer).functions.claim(signer.address, AddressZero, 0)).wait();
    const distOk = claimable.eq(expect70) && (await pool.functions.hasClaimed(signer.address, AddressZero, 0))[0];
    console.log("  round totalAmount:", ethers.utils.formatEther(r.totalAmount), "| claimable(70%):", ethers.utils.formatEther(claimable), "| claimed:", distOk);

    // ---- 3. crowdfunding E2E (ERC20 test token) ----
    console.log("\n[3] crowdfunding E2E...");
    const token = await deployExternalToken(signer, "TestUSD", "TUSD", parseEther("1000000").toString());
    const deadline = (await ts()) + 70;
    const txc = await factory.connect(signer).functions.createCampaign(token.address, parseEther("0.0001"), 100, 1000, deadline);
    const rc = await txc.wait();
    const campAddr = rc.events.find((e: any) => e.event === "CrowdfundingCreated").args.campaign;
    const cf = await ethers.getContractAt("CrowdfundingV1", campAddr);
    console.log("  campaign:", campAddr);
    await (await token.connect(signer).functions.approve(campAddr, parseEther("1000000"))).wait();
    await (await cf.connect(signer).functions.contribute(100)).wait(); // meets soft cap
    console.log("  contributed 100 shares; waiting for deadline...");
    await waitUntil(deadline + 2);
    await (await cf.connect(signer).functions.finalize()).wait();
    const cfStatus = (await cf.functions.status())[0];

    // deploy a V2 pool mirroring contributions (single investor 100%), activate, claim
    const cfPool = await deployRewardPool(pm, pmc, signer, [signer.address, DEAD], [100, 1], 0, '{"name":"CF distribution"}', prepay.toString());
    await (await cf.connect(signer).functions.activate(cfPool.address)).wait();
    const raised = (await cf.functions.totalRaised())[0];
    const poolTokBal = (await token.functions.balanceOf(cfPool.address))[0];
    await (await cfPool.connect(signer).functions.addExternalToken(token.address)).wait();
    await (await cfPool.connect(signer).functions.createDistribution(token.address)).wait();
    const before = (await token.functions.balanceOf(signer.address))[0];
    await (await cfPool.connect(signer).functions.claim(signer.address, token.address, 0)).wait();
    const after = (await token.functions.balanceOf(signer.address))[0];
    const cfOk = cfStatus === 3 && poolTokBal.eq(raised) && after.sub(before).gt(0);
    console.log("  status Activated:", cfStatus === 3, "| funds to pool:", poolTokBal.eq(raised), "| claimed:", ethers.utils.formatEther(after.sub(before)), "TUSD");

    // ---- save ----
    const out = {
        network: "basesepolia", deployer: signer.address,
        storage: storage.address, poolMasterConfig: pmc.address, poolMaster: pm.address,
        distributionPoolV2Logic: v2.address, crowdfundingFactory: factory.address,
        v2DistributionPool: pool.address, crowdfundingCampaign: campAddr,
    };
    fs.writeFileSync("deploys/deploy_base_sepolia_v2.json", JSON.stringify(out, null, 2));
    console.log("\n" + ((distOk && cfOk) ? "✅ FULL E2E PASSED on Base Sepolia (V2 distribution + crowdfunding)" : "❌ E2E had failures — review logs"));
    console.log(JSON.stringify(out, null, 2));
    if (!(distOk && cfOk)) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
