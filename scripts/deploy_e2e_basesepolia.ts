// Fresh full-stack deploy + end-to-end of DistributionPoolV2 AND CrowdfundingV1
// on Base Sepolia (live), using the local deployer key (0x305D...).
//
//   npx hardhat run scripts/deploy_e2e_basesepolia.ts --network basesepolia
import { ethers } from "hardhat";
import fs from "fs";
import { deployRewardPool } from "../test/utils/deploys";

const AddressZero = ethers.constants.AddressZero;
const parseEther = ethers.utils.parseEther;
const DEAD = "0x000000000000000000000000000000000000dEaD";

// The helpers in test/utils/deploys fire transactions without awaiting them.
// Hardhat's in-memory node auto-mines, so that is invisible in the unit tests;
// on a live chain the next call estimates gas against a state where the
// previous transaction has not landed yet, and the run dies with NO_LOGIC_SET.
// Everything this script sends therefore goes through `send`, which waits.
async function send(p: Promise<any>) { return (await p).wait(2); }

// Base Sepolia's public endpoint is load balanced, so an eth_call issued right
// after a write can land on a replica that has not caught up and read stale
// state. Reads that a subsequent assertion depends on go through this.
async function readWithRetry<T>(fn: () => Promise<T>, ok: (v: T) => boolean, label: string, tries = 8): Promise<T> {
    let last: T = await fn();
    for (let i = 1; i < tries && !ok(last); i++) {
        await new Promise((r) => setTimeout(r, 3000));
        console.log(`  ...re-reading ${label} (${i}/${tries - 1})`);
        last = await fn();
    }
    return last;
}

// A contract created inside a transaction (pools, participation tokens) can be
// invisible to a lagging replica for a few seconds. Block until its code shows.
async function waitForCode(addr: string, label: string) {
    for (let i = 0; i < 20; i++) {
        if ((await ethers.provider.getCode(addr)) !== "0x") return;
        console.log(`  ...waiting for ${label} code at ${addr}`);
        await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(`no code at ${addr} (${label}) after 60s`);
}

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
    //
    // Deployed inline rather than through the test helpers so that every step
    // is confirmed before the next one estimates gas, and so that the proxies
    // are initialised exactly the way the MAINNET script does it — with
    // initLogicAndCall (AUDIT 2026-08 / B-7): logic and `initialize` in ONE
    // transaction, so the proxy is never live-but-ownerless for a front-runner
    // to claim. This run is therefore live-chain coverage of that fix too.
    console.log("\n[1] deploying stack (storage, pool master, V2 logic)...");
    const ES = await ethers.getContractFactory("EternalStorage");
    const storage = await ES.connect(signer).deploy();
    await storage.deployed();

    const PMC = await ethers.getContractFactory("PoolMasterConfig");
    const PM = await ethers.getContractFactory("PoolMaster");
    const PROXY = await ethers.getContractFactory("LogicProxy");

    const pmcLogic = await PMC.connect(signer).deploy(storage.address);
    await pmcLogic.deployed();
    const pmcProxy = await PROXY.connect(signer).deploy(storage.address, "PoolMasterConfig.proxy");
    await pmcProxy.deployed();
    await send(storage.connect(signer).functions.grantUserRole(pmcProxy.address));
    await send(storage.connect(signer).functions.grantAdminRole(pmcProxy.address));
    await send(pmcProxy.connect(signer).functions.initLogicAndCall(
        pmcLogic.address,
        PMC.interface.encodeFunctionData("initialize", [1, 1, 1, signer.address, 10000])
    ));
    const pmc = pmcLogic.attach(pmcProxy.address);

    const pmLogic = await PM.connect(signer).deploy(storage.address);
    await pmLogic.deployed();
    const pmProxy = await PROXY.connect(signer).deploy(storage.address, "PoolMaster.proxy");
    await pmProxy.deployed();
    await send(storage.connect(signer).functions.grantUserRole(pmProxy.address));
    await send(storage.connect(signer).functions.grantAdminRole(pmProxy.address));
    await send(pmProxy.connect(signer).functions.initLogicAndCall(
        pmLogic.address,
        PM.interface.encodeFunctionData("initialize", [pmc.address])
    ));
    const pm = pmLogic.attach(pmProxy.address);

    // The delegatecall inside initLogicAndCall preserves msg.sender, so the
    // owner must be this EOA. If it is not, something claimed the proxy.
    const pmcOwner = await readWithRetry(
        async () => (await pmc.functions.owner())[0], (v) => v === signer.address, "pmc.owner");
    const pmOwner = await readWithRetry(
        async () => (await pm.functions.owner())[0], (v) => v === signer.address, "pm.owner");
    if (pmcOwner !== signer.address || pmOwner !== signer.address) {
        throw new Error(`OWNERSHIP MISMATCH — pmc:${pmcOwner} pm:${pmOwner} expected:${signer.address}`);
    }
    console.log("  ownership after initLogicAndCall: pmc & pm owned by deployer ✓");

    const V2 = await ethers.getContractFactory("DistributionPoolV2");
    const v2 = await V2.connect(signer).deploy(storage.address);
    await v2.deployed();
    await send(storage.connect(signer).functions.grantUserRole(v2.address));
    await send(pmc.connect(signer).functions.addLogicVersion(v2.address, 1, "DistributionPoolV2"));
    await send(pm.connect(signer).functions.createPoolMasterTreasuryPool([signer.address], [100], ""));
    console.log("  storage:", storage.address, "| pmc:", pmc.address, "| pm:", pm.address, "| v2:", v2.address);

    const F = await ethers.getContractFactory("CrowdfundingFactory");
    const factory = await F.connect(signer).deploy();
    await factory.deployed();
    console.log("  CrowdfundingFactory:", factory.address);

    // ---- 2. V2 distribution E2E (native) ----
    console.log("\n[2] V2 distribution E2E...");
    const prepay = parseEther("0.0005");
    const pool = await deployRewardPool(pm, pmc, signer, [signer.address, DEAD], [70, 30], 0, '{"name":"BaseSepolia V2 E2E"}', prepay.toString());
    await waitForCode(pool.address, "V2 pool");
    console.log("  pool:", pool.address, "| version:", (await pool.functions.getPoolVersion())[0]);
    await send(pool.connect(signer).functions.deposit({ value: parseEther("0.001") }));
    await send(pool.connect(signer).functions.createDistribution(AddressZero));
    const r = await pool.functions.getRound(AddressZero, 0);
    const expect70 = r.totalAmount.mul(70).div(100);
    const claimable = (await pool.functions.getClaimable(signer.address, AddressZero, 0))[0];
    await send(pool.connect(signer).functions.claim(signer.address, AddressZero, 0));
    const claimed = await readWithRetry(
        async () => (await pool.functions.hasClaimed(signer.address, AddressZero, 0))[0],
        (v) => v === true, "hasClaimed");
    const distOk = claimable.eq(expect70) && claimed;
    console.log("  round totalAmount:", ethers.utils.formatEther(r.totalAmount), "| claimable(70%):", ethers.utils.formatEther(claimable), "| claimed:", distOk);

    // ---- 3. crowdfunding E2E (ERC20 test token) ----
    console.log("\n[3] crowdfunding E2E...");
    const TT = await ethers.getContractFactory("TestToken");
    const token = await TT.connect(signer).deploy("TestUSD", "TUSD", parseEther("1000000").toString());
    await token.deployed();
    const deadline = (await ts()) + 70;
    const txc = await factory.connect(signer).functions.createCampaign(token.address, parseEther("0.0001"), 100, 1000, deadline);
    const rc = await txc.wait();
    const campAddr = rc.events.find((e: any) => e.event === "CrowdfundingCreated").args.campaign;
    await waitForCode(campAddr, "crowdfunding campaign");
    const cf = await ethers.getContractAt("CrowdfundingV1", campAddr);
    console.log("  campaign:", campAddr);
    await send(token.connect(signer).functions.approve(campAddr, parseEther("1000000")));
    await send(cf.connect(signer).functions.contribute(100)); // meets soft cap
    console.log("  contributed 100 shares; waiting for deadline...");
    await waitUntil(deadline + 2);
    await send(cf.connect(signer).functions.finalize());
    const cfStatus = (await cf.functions.status())[0];

    // deploy a V2 pool mirroring contributions (single investor 100%)
    const cfPool = await deployRewardPool(pm, pmc, signer, [signer.address, DEAD], [100, 1], 0, '{"name":"CF distribution"}', prepay.toString());
    await waitForCode(cfPool.address, "CF distribution pool");
    const raised = (await cf.functions.totalRaised())[0];

    // AUDIT 2026-08 (N-1): activation is now propose -> 7-day notice -> activate,
    // and during the notice any investor may `optOut`. A live chain cannot be
    // fast-forwarded, so this run proves everything up to and including the
    // timelock refusing an early activation; `finish_cf_basesepolia.js` finishes
    // the campaign once the week has actually passed. The timed transitions
    // themselves are covered with warped clocks in
    // test/crowdfunding/audit_2026_08_crowdfunding.ts.
    await send(cf.connect(signer).functions.proposeActivation(cfPool.address));
    const [pendingSplitter, eta] = await cf.functions.getPendingActivation();
    //
    // The assertion is made with a raw eth_call rather than a real transaction:
    // a send goes through estimateGas first, and the public endpoint answers that
    // with a bare "execution reverted" — no custom-error payload — so we could
    // only prove that SOMETHING reverted, not which guard fired. eth_call carries
    // the four-byte selector, which pins it to ActivationTimelockPending exactly.
    //
    // Base Sepolia's endpoint hands that selector back as an ordinary eth_call
    // RETURN VALUE instead of raising a JSON-RPC error, so both shapes are read.
    const TIMELOCK_ERR = ethers.utils.id("ActivationTimelockPending()").slice(0, 10);
    let revertData = "";
    try {
        revertData = await ethers.provider.call({
            to: campAddr,
            from: signer.address,
            data: cf.interface.encodeFunctionData("activate", [cfPool.address]),
        });
    } catch (e: any) {
        revertData = e.data || e.error?.data?.data || e.error?.data || e.message || "";
    }
    const timelockHolds = typeof revertData === "string" && revertData.startsWith(TIMELOCK_ERR);
    console.log("  early activate rejected:", timelockHolds
        ? `ActivationTimelockPending (${TIMELOCK_ERR}) ✓`
        : `❌ activate() did NOT hit the timelock — got: ${revertData || "(empty = it would have succeeded)"}`);
    // The other half of N-1: the notice period is only a protection if the
    // investor can actually leave during it. Probed with eth_call so the escrow
    // is left intact — a real optOut would refund the contribution AND withdraw
    // the proposal, which is exactly the behaviour test/crowdfunding covers.
    let optOutOk = false;
    try {
        const ret = await ethers.provider.call({
            to: campAddr, from: signer.address,
            data: cf.interface.encodeFunctionData("optOut", []),
        });
        optOutOk = ret.length === 66 && ethers.BigNumber.from(ret).eq(raised);
        console.log("  optOut available during notice, would refund:",
            ethers.utils.formatEther(ethers.BigNumber.from(ret)), "TUSD", optOutOk ? "✓" : "❌");
    } catch (e: any) {
        console.log("  ❌ optOut rejected during the notice period:", e.reason || e.message);
    }

    const cfOk = cfStatus === 1 /* Succeeded */ && pendingSplitter === cfPool.address && timelockHolds && optOutOk;
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
