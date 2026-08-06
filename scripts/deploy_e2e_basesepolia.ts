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
    // NOTE (AUDIT 2026-08 / B-7): this helper still does initLogic and
    // initialize as two transactions, which is front-runnable on a public
    // chain. It is fine for a throwaway testnet stack; the MAINNET script
    // (deploy_base_mainnet_v2.ts) uses initLogicAndCall so the proxy is never
    // live-but-ownerless.
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

    // deploy a V2 pool mirroring contributions (single investor 100%)
    const cfPool = await deployRewardPool(pm, pmc, signer, [signer.address, DEAD], [100, 1], 0, '{"name":"CF distribution"}', prepay.toString());
    const raised = (await cf.functions.totalRaised())[0];

    // AUDIT 2026-08 (N-1): activation is now propose -> 7-day notice -> activate,
    // and during the notice any investor may `optOut`. A live chain cannot be
    // fast-forwarded, so this run proves everything up to and including the
    // timelock refusing an early activation; `finish_cf_basesepolia.js` finishes
    // the campaign once the week has actually passed. The timed transitions
    // themselves are covered with warped clocks in
    // test/crowdfunding/audit_2026_08_crowdfunding.ts.
    await (await cf.connect(signer).functions.proposeActivation(cfPool.address)).wait();
    const [pendingSplitter, eta] = await cf.functions.getPendingActivation();
    let timelockHolds = false;
    try {
        await (await cf.connect(signer).functions.activate(cfPool.address)).wait();
        console.log("  ❌ activate() went through DURING the notice period");
    } catch (e: any) {
        timelockHolds = /ActivationTimelockPending/.test(e.errorName || e.message || "");
        console.log("  early activate rejected:", timelockHolds ? "ActivationTimelockPending ✓" : `unexpected: ${e.reason || e.message}`);
    }
    const cfOk = cfStatus === 1 /* Succeeded */ && pendingSplitter === cfPool.address && timelockHolds;
    console.log("  status Succeeded:", cfStatus === 1, "| escrow held:", ethers.utils.formatEther(raised), "TUSD",
        "| activation announced for:", new Date(eta.toNumber() * 1000).toISOString());

    // ---- save ----
    const out = {
        network: "basesepolia", deployer: signer.address,
        storage: storage.address, poolMasterConfig: pmc.address, poolMaster: pm.address,
        distributionPoolV2Logic: v2.address, crowdfundingFactory: factory.address,
        v2DistributionPool: pool.address, crowdfundingCampaign: campAddr,
        crowdfundingPool: cfPool.address, crowdfundingToken: token.address,
        activationEta: eta.toNumber(),
    };
    fs.writeFileSync("deploys/deploy_base_sepolia_v2.json", JSON.stringify(out, null, 2));
    console.log("\n" + ((distOk && cfOk)
        ? "✅ E2E PASSED on Base Sepolia (V2 distribution complete; crowdfunding through proposeActivation)"
        : "❌ E2E had failures — review logs"));
    console.log("   finish the campaign after the notice period with:");
    console.log("   npx hardhat run scripts/finish_cf_basesepolia.js --network basesepolia");
    console.log(JSON.stringify(out, null, 2));
    if (!(distOk && cfOk)) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
