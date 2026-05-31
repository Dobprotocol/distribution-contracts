// End-to-end on-chain test of DistributionPoolV2 on Arbitrum Sepolia (live).
// Creates a V2 reward pool, deposits native, creates a distribution round,
// and claims a shareholder's pro-rata share — asserting on-chain state.
//
//   npx hardhat run scripts/e2e_v2_arbsepolia.js --network arbitrumsepolia
const hre = require("hardhat");
const { ethers } = hre;

const PM = "0x95De73d20F1448bFFB2D15B716cE0BfA4731E309"; // PoolMaster proxy
const AddressZero = ethers.constants.AddressZero;

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address);

  // shareholders: signer (70%) + a throwaway address (30%) — totalSupply 100
  const other = "0x000000000000000000000000000000000000dEaD";
  const users = [signer.address, other];
  const shares = [70, 30];

  const pm = await ethers.getContractAt("PoolMaster", PM, signer);
  console.log("creating V2 reward pool (latest logic version)...");
  const prepay = ethers.utils.parseEther("0.001");
  const txc = await pm.createRewardPool(users, shares, 0, '{"name":"V2 E2E"}', AddressZero, { value: prepay });
  const rc = await txc.wait();

  let poolAddr, logicVersion;
  for (const ev of rc.events || []) {
    if (ev.event === "CreatePool") {
      poolAddr = ev.args.contractAddress;
      logicVersion = ev.args.logicVersion.toString();
    }
  }
  console.log("pool:", poolAddr, "| logicVersion:", logicVersion);

  const pool = await ethers.getContractAt("DistributionPoolV2", poolAddr, signer);
  console.log("getPoolVersion:", await pool.getPoolVersion());

  // deposit native to distribute
  const deposit = ethers.utils.parseEther("0.004");
  console.log("depositing", ethers.utils.formatEther(deposit), "ETH...");
  await (await pool.deposit({ value: deposit })).wait();

  // create distribution round (O(1))
  console.log("createDistribution...");
  const txd = await pool.createDistribution(AddressZero);
  const rd = await txd.wait();
  for (const ev of rd.events || []) {
    if (ev.event === "DistributionRoundCreated") {
      console.log("  DistributionRoundCreated round", ev.args.roundId.toString(),
        "totalAmount", ethers.utils.formatEther(ev.args.totalAmount),
        "commission", ethers.utils.formatEther(ev.args.commission),
        "supply", ev.args.totalSupplySnapshot.toString());
    }
  }

  const roundCount = (await pool.getRoundCount(AddressZero)).toString();
  const r = await pool.getRound(AddressZero, 0);
  const expectedTotal = deposit.mul(9950).div(10000); // 0.5% commission
  const expectedClaim = r.totalAmount.mul(70).div(100);
  const claimablePre = await pool.getClaimable(signer.address, AddressZero, 0);

  console.log("--- assertions ---");
  console.log("roundCount == 1:", roundCount === "1");
  console.log("totalAmount == deposit-0.5%:", r.totalAmount.eq(expectedTotal), ethers.utils.formatEther(r.totalAmount));
  console.log("supplySnapshot == 100:", r.totalSupplySnapshot.toString() === "100");
  console.log("claimable(signer 70%) matches:", claimablePre.eq(expectedClaim), ethers.utils.formatEther(claimablePre));

  // claim for signer (permissionless; funds go to signer)
  console.log("claim...");
  const txk = await pool.claim(signer.address, AddressZero, 0);
  await txk.wait();

  const r2 = await pool.getRound(AddressZero, 0);
  const claimablePost = await pool.getClaimable(signer.address, AddressZero, 0);
  const claimed = await pool.hasClaimed(signer.address, AddressZero, 0);
  console.log("hasClaimed == true:", claimed);
  console.log("claimable now == 0:", claimablePost.eq(0));
  console.log("round.totalClaimed == claim:", r2.totalClaimed.eq(expectedClaim), ethers.utils.formatEther(r2.totalClaimed));

  // double-claim must revert
  let doubleReverted = false;
  try { await (await pool.claim(signer.address, AddressZero, 0)).wait(); }
  catch (e) { doubleReverted = true; }
  console.log("double-claim reverts:", doubleReverted);

  const ok = roundCount === "1" && r.totalAmount.eq(expectedTotal) &&
    r.totalSupplySnapshot.toString() === "100" && claimablePre.eq(expectedClaim) &&
    claimed && claimablePost.eq(0) && r2.totalClaimed.eq(expectedClaim) && doubleReverted;
  console.log(ok ? "\n✅ E2E PASSED — V2 create/distribute/claim verified on-chain" : "\n❌ E2E FAILED");
  console.log("pool address:", poolAddr);
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
