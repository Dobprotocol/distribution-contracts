// End-to-end on-chain test of DistributionPoolV2 on BASE MAINNET (live, real).
// Creates a V2 reward pool via the production V2 PoolMaster, deposits native ETH,
// creates a distribution round, claims a shareholder's pro-rata share, and asserts
// on-chain state (incl. double-claim revert). Small amounts (test pool, no real funds).
//
//   npx hardhat run scripts/e2e_v2_base_mainnet.js --network base
const hre = require("hardhat");
const { ethers } = hre;

const PM = "0x240f4b752189a68BD0C2B5B1dF5b29cB58e7CCF6"; // Base mainnet V2 PoolMaster proxy
const AddressZero = ethers.constants.AddressZero;

// Public mainnet.base.org is load-balanced: a read right after a write can hit a
// lagging node. Retry reads a few times before giving up.
async function readRetry(label, fn, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { if (i === tries - 1) throw e; await new Promise(r => setTimeout(r, 2500)); }
  }
}

async function main() {
  const [signer] = await ethers.getSigners();
  const bal0 = await signer.getBalance();
  console.log("signer:", signer.address, "| balance:", ethers.utils.formatEther(bal0), "ETH");

  const other = "0x000000000000000000000000000000000000dEaD";
  const users = [signer.address, other];
  const shares = [70, 30];

  const pm = await ethers.getContractAt("PoolMaster", PM, signer);
  console.log("creating V2 reward pool (latest logic version)...");
  const prepay = ethers.utils.parseEther("0.0001");
  const txc = await pm.createRewardPool(users, shares, 0, '{"name":"V2 mainnet E2E"}', AddressZero, { value: prepay });
  const rc = await txc.wait(2);

  let poolAddr, logicVersion;
  for (const ev of rc.events || []) {
    if (ev.event === "CreatePool") { poolAddr = ev.args.contractAddress; logicVersion = ev.args.logicVersion.toString(); }
  }
  console.log("pool:", poolAddr, "| logicVersion:", logicVersion, "| createPool tx:", txc.hash);

  const pool = await ethers.getContractAt("DistributionPoolV2", poolAddr, signer);
  console.log("getPoolVersion:", await readRetry("getPoolVersion", () => pool.getPoolVersion()));

  const deposit = ethers.utils.parseEther("0.0004");
  console.log("depositing", ethers.utils.formatEther(deposit), "ETH...");
  await (await pool.deposit({ value: deposit })).wait(2);

  console.log("createDistribution...");
  const txd = await pool.createDistribution(AddressZero);
  const rd = await txd.wait(2);
  for (const ev of rd.events || []) {
    if (ev.event === "DistributionRoundCreated") {
      console.log("  DistributionRoundCreated round", ev.args.roundId.toString(),
        "totalAmount", ethers.utils.formatEther(ev.args.totalAmount),
        "commission", ethers.utils.formatEther(ev.args.commission),
        "supply", ev.args.totalSupplySnapshot.toString());
    }
  }
  console.log("  createDistribution tx:", txd.hash);

  const roundCount = (await readRetry("roundCount", () => pool.getRoundCount(AddressZero))).toString();
  const r = await pool.getRound(AddressZero, 0);
  const expectedTotal = deposit.mul(9950).div(10000); // 0.5% commission
  const expectedClaim = r.totalAmount.mul(70).div(100);
  const claimablePre = await pool.getClaimable(signer.address, AddressZero, 0);

  console.log("--- assertions ---");
  console.log("roundCount == 1:", roundCount === "1");
  console.log("totalAmount == deposit-0.5%:", r.totalAmount.eq(expectedTotal), ethers.utils.formatEther(r.totalAmount));
  console.log("supplySnapshot == 100:", r.totalSupplySnapshot.toString() === "100");
  console.log("claimable(signer 70%) matches:", claimablePre.eq(expectedClaim), ethers.utils.formatEther(claimablePre));

  console.log("claim...");
  const txk = await pool.claim(signer.address, AddressZero, 0);
  await txk.wait(2);
  console.log("  claim tx:", txk.hash);

  const r2 = await pool.getRound(AddressZero, 0);
  const claimablePost = await pool.getClaimable(signer.address, AddressZero, 0);
  const claimed = await pool.hasClaimed(signer.address, AddressZero, 0);
  console.log("hasClaimed == true:", claimed);
  console.log("claimable now == 0:", claimablePost.eq(0));
  console.log("round.totalClaimed == claim:", r2.totalClaimed.eq(expectedClaim), ethers.utils.formatEther(r2.totalClaimed));

  let doubleReverted = false;
  try { await (await pool.claim(signer.address, AddressZero, 0)).wait(); }
  catch (e) { doubleReverted = true; }
  console.log("double-claim reverts:", doubleReverted);

  const ok = roundCount === "1" && r.totalAmount.eq(expectedTotal) &&
    r.totalSupplySnapshot.toString() === "100" && claimablePre.eq(expectedClaim) &&
    claimed && claimablePost.eq(0) && r2.totalClaimed.eq(expectedClaim) && doubleReverted;
  console.log(ok ? "\n✅ E2E PASSED — V2 create/distribute/claim verified on BASE MAINNET" : "\n❌ E2E FAILED");
  console.log("POOL_ADDRESS=" + poolAddr);
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
