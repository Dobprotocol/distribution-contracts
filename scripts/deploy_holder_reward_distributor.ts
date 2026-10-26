// HolderRewardDistributor — repartir a los holders de un token que ya existe.
//
//   npx hardhat run scripts/deploy_holder_reward_distributor.ts --network basesepolia
//   npx hardhat run scripts/deploy_holder_reward_distributor.ts --network base
//
// Uno por cadena. La comision va al mismo lugar que la de DistributionPoolV2:
// el treasury pool del PoolMaster V2 (`getTreasuryPool()`), 50 bps salvo que se
// pase HOLDER_FEE_BPS. El owner (quien puede mover la comision) es el deployer
// salvo que se pase HOLDER_OWNER; va en el constructor, no hay `initialize`.
//
// Lo pone en circulacion `networks.holder_reward_distributor` en la DB, que se
// actualiza aparte (el script solo imprime el UPDATE).
import { ethers } from "hardhat";
import fs from "fs";

type Cfg = { file: string; networkId: number };

const CONFIG: Record<string, Cfg> = {
  base: { file: "deploys/deploy_base_mainnet_v2.json", networkId: 8 },
  basesepolia: { file: "deploys/deploy_base_sepolia_v2.json", networkId: 6 }, // networks.id, no chain id
};
const BY_CHAIN: Record<number, string> = { 8453: "base", 84532: "basesepolia" };

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const net = BY_CHAIN[chainId];
  if (!net) throw new Error(`no CONFIG for chain ${chainId}`);
  const cfg = CONFIG[net];
  const d = fs.existsSync(cfg.file) ? JSON.parse(fs.readFileSync(cfg.file, "utf8")) : {};
  const [s] = await ethers.getSigners();
  const owner = process.env.HOLDER_OWNER || s.address;
  const feeBps = Number(process.env.HOLDER_FEE_BPS ?? 50);

  let feeRecipient = process.env.HOLDER_FEE_RECIPIENT || "";
  if (!feeRecipient) {
    if (!d.poolMaster) throw new Error(`${cfg.file} no tiene poolMaster; pasa HOLDER_FEE_RECIPIENT`);
    const pm = await ethers.getContractAt(["function getTreasuryPool() view returns (address)"], d.poolMaster);
    feeRecipient = await pm.getTreasuryPool();
  }

  console.log(`red: ${net}`);
  console.log(`deployer: ${s.address} | balance: ${ethers.utils.formatEther(await s.getBalance())} ETH`);
  console.log(`owner: ${owner}${owner === s.address ? " (el propio deployer)" : ""}`);
  console.log(`comision: ${feeBps} bps -> ${feeRecipient}`);

  const D = await ethers.getContractFactory("HolderRewardDistributor");
  const dist = await D.deploy(owner, feeRecipient, feeBps);
  await dist.deployed();
  console.log(`\nHolderRewardDistributor desplegado en ${dist.address}`);
  console.log(`  tx ${dist.deployTransaction.hash}`);

  // Comprobacion real, no el eco de lo que acabamos de mandar.
  console.log("\nestado on-chain:");
  console.log(`  owner = ${await dist.owner()}`);
  console.log(`  feeRecipient = ${await dist.feeRecipient()} | feeBps = ${await dist.feeBps()}`);
  console.log(`  roundCount = ${await dist.roundCount()}`);

  d.holderRewardDistributor = dist.address;
  d.holderRewardDistributorOwner = owner;
  fs.writeFileSync(cfg.file, JSON.stringify(d, null, 2) + "\n");
  console.log(`\nguardado en ${cfg.file}`);

  console.log("\nfalta en la DB (no lo hace este script):");
  console.log(`  UPDATE networks SET holder_reward_distributor = '${dist.address}' WHERE id = ${cfg.networkId};`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
