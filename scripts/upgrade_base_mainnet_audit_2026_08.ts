// AUDIT 2026-08 — despliegue de los fixes V2 en Base mainnet.
//
// Tres piezas, ninguna toca los 30 pools V1 ni los pools V2 ya creados:
//
//   1. DistributionPoolV2 (logica nueva) -> PoolMasterConfig.addLogic
//      Los pools NUEVOS la usan (PoolMaster siempre toma la ultima version).
//      Los pools V2 existentes siguen con la version 1: cada uno es un
//      LogicProxy propio y habria que llamar upgradeTo pool por pool.
//   2. PoolMaster (logica nueva) -> upgradeTo en su proxy.
//      Trae B-5 (authorizeSnapshotter al crear el pool) y el bytecode nuevo de
//      ParticipationToken, que va compilado dentro (`new ParticipationToken`).
//   3. CrowdfundingFactory nueva. La factory NO es upgradeable y hace
//      `new CrowdfundingV1(...)`, asi que la unica forma de publicar los fixes
//      de la campana es desplegar una factory nueva y apuntar la DB a ella.
//      Las 7 campanas vivas siguen con el codigo viejo (no son upgradeables).
//
// TokenSaleMarket queda fuera a proposito: su owner es 0xe5Ed5d93…, no nuestro
// deployer, asi que no podemos hacerle upgradeTo desde aqui.
//
//   npx hardhat run scripts/upgrade_base_mainnet_audit_2026_08.ts --network base
import { ethers } from "hardhat";
import fs from "fs";

const DEPLOY_FILE = "deploys/deploy_base_mainnet_v2.json";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const send = async (p: any) => { const tx = await p; const r = await tx.wait(1); await sleep(3000); return r; };

// El RPC de Base tarda en ver el codigo de un contrato recien desplegado. El
// caso concreto que rompio la primera corrida: `upgradeTo` hace un STATICCALL a
// `proxiableUUID()` de la logica nueva para estimar el gas, y el nodo todavia
// veia esa direccion vacia -> "execution reverted" sin datos. No es un error de
// permisos ni de UUID: es propagacion. Reintentar con pausas lo resuelve.
const retry = async <T>(what: string, fn: () => Promise<T>, tries = 6): Promise<T> => {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e: any) {
      if (i >= tries) throw e;
      console.log(`    ${what}: intento ${i} fallo (${e.reason || e.message}); reintentando en 8s`);
      await sleep(8000);
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

  const storage = await ethers.getContractAt("EternalStorage", d.storage);
  const pmc = await ethers.getContractAt("PoolMasterConfig", d.poolMasterConfig);
  const pmProxy = await ethers.getContractAt("LogicProxiable", d.poolMaster);

  // Sin esto el resto son transacciones que revierten y gastan gas para nada.
  const pmcOwner = (await pmc.functions.owner())[0];
  if (pmcOwner.toLowerCase() !== s.address.toLowerCase()) {
    throw new Error(`PoolMasterConfig.owner = ${pmcOwner}, no ${s.address}`);
  }
  const pmImplBefore = (await pmProxy.functions.getImplementation())[0];
  const verBefore = (await pmc.functions.getLatestVersionNumber())[0].toString();
  console.log("estado previo -> logicVersion:", verBefore, "| PoolMaster impl:", pmImplBefore);

  // ---- 1. DistributionPoolV2 -------------------------------------------
  console.log("\n[1] desplegando DistributionPoolV2 (fixes de auditoria)...");
  const V2 = await ethers.getContractFactory("DistributionPoolV2");
  const v2 = await V2.deploy(d.storage); await v2.deployed();
  console.log("    logica:", v2.address);
  // La logica escribe en el EternalStorage a traves del proxy del pool, pero
  // el propio contrato tambien necesita el rol (asi se hizo en el deploy inicial).
  await retry("grantUserRole", () => send(storage.functions.grantUserRole(v2.address)));
  console.log("    grantUserRole ok");
  await retry("addLogic", () => send(pmc.functions.addLogic(v2.address, "DistributionPoolV2")));
  const verAfter = (await pmc.functions.getLatestVersionNumber())[0].toString();
  const [regAddr, regName] = await pmc.functions.getLatestVersion();
  if (regAddr.toLowerCase() !== v2.address.toLowerCase()) {
    throw new Error(`la version ${verAfter} apunta a ${regAddr}, no a ${v2.address}`);
  }
  console.log(`    registrada como version ${verAfter} (${regName})`);

  // ---- 2. PoolMaster ----------------------------------------------------
  console.log("\n[2] desplegando PoolMaster nuevo y actualizando el proxy...");
  const PM = await ethers.getContractFactory("PoolMaster");
  const pmLogic = await PM.deploy(d.storage); await pmLogic.deployed();
  console.log("    logica:", pmLogic.address);
  await retry("upgradeTo", () => send(pmProxy.functions.upgradeTo(pmLogic.address)));
  const pmImplAfter = (await pmProxy.functions.getImplementation())[0];
  if (pmImplAfter.toLowerCase() !== pmLogic.address.toLowerCase()) {
    throw new Error(`el proxy quedo en ${pmImplAfter}, no en ${pmLogic.address}`);
  }
  // El upgrade no debe haber tocado el estado: mismo owner, misma config.
  const pmAfter = await ethers.getContractAt("PoolMaster", d.poolMaster);
  const pmOwner = (await pmAfter.functions.owner())[0];
  if (pmOwner.toLowerCase() !== s.address.toLowerCase()) {
    throw new Error(`PoolMaster.owner quedo en ${pmOwner} tras el upgrade`);
  }
  console.log("    proxy apuntando a la logica nueva, owner intacto");

  // ---- 3. CrowdfundingFactory ------------------------------------------
  console.log("\n[3] desplegando CrowdfundingFactory nueva...");
  const CF = await ethers.getContractFactory("CrowdfundingFactory");
  const cf = await CF.deploy(); await cf.deployed();
  console.log("    factory:", cf.address);

  const bal1 = await s.getBalance();
  const out = {
    ...d,
    distributionPoolV2Logic: v2.address,
    poolMasterLogic: pmLogic.address,
    crowdfundingFactory: cf.address,
    logicVersion: verAfter,
    audit_2026_08: {
      date: "2026-08-06",
      previous: {
        distributionPoolV2Logic: d.distributionPoolV2Logic,
        poolMasterLogic: pmImplBefore,
        crowdfundingFactory: d.crowdfundingFactory,
        logicVersion: verBefore,
      },
      tokenSaleMarket: "NO actualizado: owner 0xe5Ed5d930Bd6D183C9C973aF3D6f81f1700Cf084, fuera de nuestro control",
      gasSpentEth: ethers.utils.formatEther(bal0.sub(bal1)),
    },
  };
  fs.writeFileSync(DEPLOY_FILE, JSON.stringify(out, null, 2));
  console.log("\nGas gastado:", ethers.utils.formatEther(bal0.sub(bal1)), "ETH | restante:", ethers.utils.formatEther(bal1));
  console.log("\nActualizar en la tabla networks (id=8):");
  console.log("  distribution_pool_v2_logic =", v2.address);
  console.log("  crowdfunding_factory       =", cf.address);
}
main().catch((e) => { console.error(e.reason || e.message); process.exit(1); });
