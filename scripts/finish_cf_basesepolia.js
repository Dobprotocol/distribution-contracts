// Second half of the Base Sepolia crowdfunding E2E.
//
// `deploy_e2e_basesepolia.ts` now runs the campaign all the way through
// activation in one sitting (ACTIVATION_TIMELOCK is zero), so on a fresh run
// this script picks up an already-Activated campaign and only does the part
// that belongs to the pool rather than to the campaign:
// createDistribution -> claim.
//
// The activation branch below is kept for a campaign left mid-flight — for
// instance one where an investor opted out and the proposal has to be renewed,
// or one created against a build with a non-zero timelock.
//
//   npx hardhat run scripts/finish_cf_basesepolia.js --network basesepolia
//
// Addresses come from deploys/deploy_base_sepolia_v2.json, written by the first
// script — nothing is hardcoded, so a fresh E2E run does not need edits here.
const { ethers } = require("hardhat");
const fs = require("fs");

const MANIFEST = "deploys/deploy_base_sepolia_v2.json";

async function main() {
  const [s] = await ethers.getSigners();
  if (!fs.existsSync(MANIFEST)) {
    throw new Error(`${MANIFEST} not found — run deploy_e2e_basesepolia.ts first`);
  }
  const d = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  console.log("campaign:", d.crowdfundingCampaign, "| pool:", d.crowdfundingPool);

  const cf = await ethers.getContractAt("CrowdfundingV1", d.crowdfundingCampaign, s);
  const cfPool = await ethers.getContractAt("DistributionPoolV2", d.crowdfundingPool, s);
  const token = await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", d.crowdfundingToken, s
  );

  const status = (await cf.functions.status())[0];
  const [pending, eta] = await cf.functions.getPendingActivation();
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  if (status === 1) {
    if (pending === ethers.constants.AddressZero) {
      throw new Error("no pending activation — an investor may have opted out; re-propose first");
    }
    if (now < eta.toNumber()) {
      const left = eta.toNumber() - now;
      throw new Error(
        `notice period still running: ${Math.ceil(left / 3600)}h left (eta ${new Date(eta.toNumber() * 1000).toISOString()})`
      );
    }
    console.log("activating...");
    await (await cf.functions.activate(pending)).wait(2);
  } else if (status === 3) {
    console.log("campaign already Activated — continuing to the distribution");
  } else {
    throw new Error(`campaign status ${status} cannot be activated`);
  }

  const raised = (await cf.functions.totalRaised())[0];
  const poolBal = await token.balanceOf(d.crowdfundingPool);
  console.log("escrow moved to pool:", poolBal.eq(raised), "|", ethers.utils.formatEther(poolBal), "TUSD");

  console.log("createDistribution(token)...");
  await (await cfPool.functions.addExternalToken(d.crowdfundingToken)).wait(2);
  await (await cfPool.functions.createDistribution(d.crowdfundingToken)).wait(2);

  console.log("claim...");
  const before = await token.balanceOf(s.address);
  await (await cfPool.functions.claim(s.address, d.crowdfundingToken, 0)).wait(2);
  const after = await token.balanceOf(s.address);
  const claimed = after.sub(before);
  console.log("claimed:", ethers.utils.formatEther(claimed), "TUSD");

  const ok = poolBal.eq(raised) && claimed.gt(0);
  console.log(ok
    ? "✅ CROWDFUNDING E2E COMPLETE on Base Sepolia"
    : "❌ FAILED — escrow or claim did not match");
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error(e.reason || e.message); process.exit(1); });
