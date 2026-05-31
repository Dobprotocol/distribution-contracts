const { ethers } = require("hardhat");
async function main() {
  const [s] = await ethers.getSigners();
  const cfPool = await ethers.getContractAt("DistributionPoolV2", "0xb96Be5618CeacB85b39De615d4AEE1A67428823e", s);
  const token = "0x7af608e2440202d4d981ace8944feb2c9390ad86";
  console.log("createDistribution(token)...");
  await (await cfPool.functions.createDistribution(token)).wait(2);
  const tokenC = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", token, s);
  const before = await tokenC.balanceOf(s.address);
  console.log("claim...");
  await (await cfPool.functions.claim(s.address, token, 0)).wait(2);
  const after = await tokenC.balanceOf(s.address);
  console.log("claimed:", ethers.utils.formatEther(after.sub(before)), "TUSD");
  console.log(after.sub(before).gt(0) ? "OK CROWDFUNDING E2E COMPLETE on Base Sepolia" : "FAIL claim 0");
}
main().catch(e => { console.error(e.reason || e.message); process.exit(1); });
