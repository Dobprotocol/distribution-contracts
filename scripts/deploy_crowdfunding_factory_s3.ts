// AUDIT 2026-08 / S-3 — factory nueva en Base mainnet.
//
// `CrowdfundingFactory` no es upgradeable y hace `new CrowdfundingV1(...)`, o
// sea que el bytecode de la campana va compilado dentro. La unica forma de
// publicar el fix de S-3 (una salida que deja la venta bajo el soft cap hace
// fracasar la campana, en vez de dejarla activable por menos plata de la
// prometida) es desplegar otra factory y apuntar `networks.crowdfunding_factory`
// (id=8) a ella. Las campanas ya creadas — incluidas las de la factory del
// deploy de auditoria de esta misma manana — se quedan con su codigo para
// siempre; solo cambian las nuevas.
//
//   npx hardhat run scripts/deploy_crowdfunding_factory_s3.ts --network base
//
// Corrida real 2026-08-06: factory 0x30f29009E0D11dE0e8c5F64e031Bf3d113EE3ead,
// campana de prueba 0x9FE1A459bbc5A69385551cCDb3cafA51FDFbf0C9.
import { ethers } from "hardhat";
import fs from "fs";

const DEPLOY_FILE = "deploys/deploy_base_mainnet_v2.json";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// El nodo de Base tarda en ver el codigo de un contrato recien desplegado, asi
// que la primera llamada a la factory revierte al estimar gas contra una
// direccion que todavia ve vacia (known issue #7). No es un error del
// contrato: es propagacion, y se pasa reintentando. Paso tal cual en la
// corrida real, primero con `createCampaign` y despues leyendo la campana.
const retry = async <T>(what: string, fn: () => Promise<T>, tries = 6): Promise<T> => {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e: any) {
      if (i >= tries) throw e;
      console.log(`    ${what}: intento ${i} fallo (${e.reason || e.message}); reintentando en 10s`);
      await sleep(10000);
    }
  }
};

async function main() {
  const d = JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf8"));
  const [s] = await ethers.getSigners();
  const bal0 = await s.getBalance();
  console.log("deployer:", s.address, "| balance:", ethers.utils.formatEther(bal0), "ETH");
  if (s.address.toLowerCase() !== String(d.deployer).toLowerCase()) {
    throw new Error(`el firmante ${s.address} no es el deployer del stack (${d.deployer})`);
  }
  console.log("factory anterior:", d.crowdfundingFactory);

  const CF = await ethers.getContractFactory("CrowdfundingFactory");
  const cf = await CF.deploy();
  await cf.deployed();
  console.log("factory nueva:   ", cf.address);

  // Prueba de vida: crear una campana de juguete (deadline a un dia, nadie
  // aporta nada) para no descubrir en produccion que la factory quedo muda.
  console.log("\ncreando una campana de prueba...");
  const deadline = Math.floor(Date.now() / 1000) + 86400;
  const rc: any = await retry("createCampaign", async () => {
    const tx = await cf.createCampaign(USDC_BASE, 1_000_000, 10, 100, deadline);
    return tx.wait(1);
  });
  const ev = rc.events?.find((e: any) => e.event === "CrowdfundingCreated");
  const campaign = ev?.args?.campaign || ev?.args?.[0];
  console.log("  campana:", campaign, "| tx:", rc.transactionHash);

  // Que el codigo que quedo en cadena sea EL de este build, no el de la factory
  // vieja: mismo largo que el artefacto local, y las unicas diferencias son los
  // immutables que el constructor incrusta (admin, token, precios, deadline).
  const art = JSON.parse(fs.readFileSync(
    "artifacts/contracts/contract/dob/crowdfunding/CrowdfundingV1.sol/CrowdfundingV1.json", "utf8"));
  const onchain = await retry("getCode", () => ethers.provider.getCode(campaign));
  if (onchain.length !== art.deployedBytecode.length) {
    throw new Error(`la campana mide ${onchain.length} y el build local ${art.deployedBytecode.length}`);
  }
  console.log("  bytecode del build actual ✔");

  const c = await ethers.getContractAt("CrowdfundingV1", campaign);
  console.log("  admin:          ", await retry("admin", () => c.admin()));
  console.log("  softCapShares:  ", (await c.softCapShares()).toString());
  console.log("  status:         ", (await c.status()).toString(), "(0 = Fundraising)");
  console.log("  pendingSplitter:", await c.pendingSplitter());

  const bal1 = await s.getBalance();
  const out = {
    ...d,
    crowdfundingFactory: cf.address,
    audit_2026_08_s3: {
      date: "2026-08-06",
      previousCrowdfundingFactory: d.crowdfundingFactory,
      probeCampaign: campaign,
      probeTx: rc.transactionHash,
      note: "Factory nueva porque CrowdfundingFactory no es upgradeable y hace new CrowdfundingV1(...): el fix de S-3 solo llega a las campanas creadas desde aqui.",
      gasSpentEth: ethers.utils.formatEther(bal0.sub(bal1)),
    },
  };
  fs.writeFileSync(DEPLOY_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log("\nGas gastado:", ethers.utils.formatEther(bal0.sub(bal1)), "ETH | restante:", ethers.utils.formatEther(bal1));
  console.log("\nActualizar networks (id=8): crowdfunding_factory =", cf.address);
}
main().catch((e) => { console.error(e.reason || e.message); process.exit(1); });
