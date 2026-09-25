// CollateralVault — el respaldo del calendario de reparto en Base.
//
//   npx hardhat run scripts/deploy_collateral_vault.ts --network basesepolia
//   npx hardhat run scripts/deploy_collateral_vault.ts --network base
//   npx hardhat run scripts/deploy_collateral_vault.ts --network robinhood
//
// Despliega el vault y deja la lista blanca puesta en la misma corrida. El
// admin del vault (quien mueve esa lista) es el deployer salvo que se pase
// VAULT_ADMIN. No hay `initialize`: el admin va en el constructor, justo para
// no repetir la ventana del despliegue en Stellar, donde el contrato quedo
// unos minutos sin inicializar y reclamable por quien llamara primero.
//
// El vault NO se registra en ningun contrato: los pools no lo conocen. Lo que
// lo pone en circulacion es `networks.collateral_vault_address` en la DB, que
// se actualiza aparte (el script solo imprime el UPDATE).
import { ethers } from "hardhat";
import fs from "fs";

type Cfg = { file: string; networkId: number; tokens: { symbol: string; address: string }[] };

const CONFIG: Record<string, Cfg> = {
  base: {
    file: "deploys/deploy_base_mainnet_v2.json",
    networkId: 8,
    tokens: [
      { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
      { symbol: "DOBI", address: "0x931eF8053E997b1Bab68d1E900a061305c0Ff4FB" },
    ],
  },
  basesepolia: {
    file: "deploys/deploy_base_sepolia_v2.json",
    networkId: 6, // networks.id of Base Sepolia is 6, not its chain id
    // En testnet no hay un USDC canonico que nos sirva; se allow-listea a mano
    // despues, o via COLLATERAL_TOKENS=0x…,0x…
    tokens: [],
  },
  robinhood: {
    file: "deploys/deploy_robinhood_v2.json",
    networkId: 4663,
    tokens: [
      { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" },
      { symbol: "USDC", address: "0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8" },
    ],
  },
};

const BY_CHAIN: Record<number, string> = { 8453: "base", 84532: "basesepolia", 4663: "robinhood" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const net = BY_CHAIN[chainId];
  if (!net) throw new Error(`no CONFIG for chain ${chainId}`);
  const cfg = CONFIG[net];
  const [s] = await ethers.getSigners();
  const admin = process.env.VAULT_ADMIN || s.address;

  const extra = (process.env.COLLATERAL_TOKENS || "")
    .split(",").map((t) => t.trim()).filter(Boolean)
    .map((address) => ({ symbol: "?", address }));
  const tokens = [...cfg.tokens, ...extra];

  console.log(`red: ${net}`);
  console.log(`deployer: ${s.address} | balance: ${ethers.utils.formatEther(await s.getBalance())} ETH`);
  console.log(`admin del vault: ${admin}${admin === s.address ? " (el propio deployer)" : ""}`);
  console.log(`tokens a aceptar: ${tokens.map((t) => `${t.symbol} ${t.address}`).join(", ") || "(ninguno)"}`);

  const Vault = await ethers.getContractFactory("CollateralVault");
  const vault = await Vault.deploy(admin);
  await vault.deployed();
  console.log(`\nCollateralVault desplegado en ${vault.address}`);
  console.log(`  tx ${vault.deployTransaction.hash}`);

  // Solo el admin puede tocar la lista. Si se paso VAULT_ADMIN distinto del
  // firmante, aqui no hay nada que hacer: lo hara ese admin por su cuenta.
  if (admin.toLowerCase() === s.address.toLowerCase()) {
    for (const t of tokens) {
      await sleep(3000);
      const tx = await vault.setTokenAllowed(t.address, true);
      await tx.wait(1);
      console.log(`  aceptado ${t.symbol} ${t.address} (tx ${tx.hash})`);
    }
  } else if (tokens.length) {
    console.log(`\n  ATENCION: la lista blanca queda vacia. El admin ${admin} debe llamar`);
    for (const t of tokens) console.log(`    setTokenAllowed(${t.address}, true)   // ${t.symbol}`);
  }

  // Comprobacion real, no el eco de lo que acabamos de mandar.
  console.log("\nestado on-chain:");
  console.log(`  admin = ${await vault.admin()}`);
  for (const t of tokens) {
    console.log(`  isTokenAllowed(${t.symbol}) = ${await vault.isTokenAllowed(t.address)}`);
  }

  const d = fs.existsSync(cfg.file) ? JSON.parse(fs.readFileSync(cfg.file, "utf8")) : {};
  d.collateralVault = vault.address;
  d.collateralVaultAdmin = admin;
  d.collateralVaultTokens = tokens.map((t) => t.address);
  fs.writeFileSync(cfg.file, JSON.stringify(d, null, 2) + "\n");
  console.log(`\nguardado en ${cfg.file}`);

  const networkId = cfg.networkId;
  console.log("\nfalta en la DB (no lo hace este script):");
  console.log(`  UPDATE networks SET collateral_vault_address = '${vault.address}' WHERE id = ${networkId};`);
  if (tokens.length) {
    const list = tokens.map((t) => `'${t.address}'`).join(", ");
    console.log(`  UPDATE tokens SET is_collateral = true WHERE network_id = ${networkId} AND address IN (${list});`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
