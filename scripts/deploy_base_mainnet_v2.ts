// Fresh Base MAINNET stack + DistributionPoolV2 + CrowdfundingFactory.
// Self-contained with explicit .deployed()/.wait() on every step (the test
// helpers omit waits — fine on instant-mining hardhat, but race on a real RPC).
// Owner/deployer = ACCOUNT_BASE (new wallet 0xd874…); parallel stack for V2.
//
//   npx hardhat run scripts/deploy_base_mainnet_v2.ts --network base
import { ethers } from "hardhat";
import fs from "fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const send = async (p: any) => { const tx = await p; await tx.wait(1); await sleep(4000); return tx; };
// retry a contract call that may hit RPC read-after-write lag (NO_LOGIC_SET etc.)
async function retry<T>(label: string, fn: () => Promise<T>, n = 6): Promise<T> {
  for (let i = 0; i < n; i++) {
    try { return await fn(); }
    catch (e: any) {
      const msg = e.reason || e.message || "";
      if (i === n - 1) throw e;
      console.log(`  retry ${label} (${i + 1}/${n}): ${msg.slice(0, 40)}`);
      await sleep(7000);
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const [s] = await ethers.getSigners();
  console.log("deployer:", s.address, "| balance:", ethers.utils.formatEther(await s.getBalance()), "ETH");

  const Storage = await ethers.getContractFactory("EternalStorage");
  const PMC = await ethers.getContractFactory("PoolMasterConfig");
  const PM = await ethers.getContractFactory("PoolMaster");
  const PROXY = await ethers.getContractFactory("LogicProxy");
  const V2 = await ethers.getContractFactory("DistributionPoolV2");
  const Factory = await ethers.getContractFactory("CrowdfundingFactory");

  console.log("[1] EternalStorage...");
  const storage = await Storage.deploy(); await storage.deployed();

  console.log("[2] PoolMasterConfig + proxy...");
  const pmcLogic = await PMC.deploy(storage.address); await pmcLogic.deployed();
  const pmcProxy = await PROXY.deploy(storage.address, "PoolMasterConfig.proxy"); await pmcProxy.deployed();
  await send(storage.functions.grantUserRole(pmcProxy.address));
  await send(storage.functions.grantAdminRole(pmcProxy.address));
  await send(pmcProxy.functions.initLogic(pmcLogic.address));
  const pmc = pmcLogic.attach(pmcProxy.address);

  console.log("[3] PoolMaster + proxy...");
  const pmLogic = await PM.deploy(storage.address); await pmLogic.deployed();
  const pmProxy = await PROXY.deploy(storage.address, "PoolMaster.proxy"); await pmProxy.deployed();
  await send(storage.functions.grantUserRole(pmProxy.address));
  await send(storage.functions.grantAdminRole(pmProxy.address));
  await send(pmProxy.functions.initLogic(pmLogic.address));
  const pm = pmLogic.attach(pmProxy.address);

  console.log("[4] DistributionPoolV2 logic...");
  const v2 = await V2.deploy(storage.address); await v2.deployed();
  await send(storage.functions.grantUserRole(v2.address));

  console.log("[5] init PMC + PM, sharesLimit 1,000,000, register V2, treasury pool...");
  await retry("pmc.initialize", () => send(pmc.functions.initialize(1, 1, 1, s.address, 10000)));
  await retry("pm.initialize", () => send(pm.functions.initialize(pmc.address)));
  await retry("setSharesLimit", () => send(pmc.functions.setSharesLimit(1000000)));
  await retry("addLogicVersion", () => send(pmc.functions.addLogicVersion(v2.address, 1, "DistributionPoolV2")));
  await retry("createTreasuryPool", () => send(pm.functions.createPoolMasterTreasuryPool([s.address], [100], "")));

  console.log("[6] CrowdfundingFactory...");
  const factory = await Factory.deploy(); await factory.deployed();

  const out = {
    network: "base-mainnet", deployer: s.address,
    storage: storage.address, poolMasterConfig: pmc.address, poolMaster: pm.address,
    distributionPoolV2Logic: v2.address, crowdfundingFactory: factory.address,
    logicVersion: (await pmc.functions.getLatestVersionNumber())[0].toString(),
    sharesLimit: (await pmc.functions.getSharesLimit())[0].toString(),
  };
  fs.writeFileSync("deploys/deploy_base_mainnet_v2.json", JSON.stringify(out, null, 2));
  console.log("\n✅ Base mainnet V2 stack deployed:\n" + JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e.reason || e.message); process.exit(1); });
