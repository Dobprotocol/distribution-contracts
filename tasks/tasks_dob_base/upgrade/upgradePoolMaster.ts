import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import { contractAt, deployerContract, upgradeContract } from "../../utils/contract-utils";
import { getSigner } from "../../utils/simulation-utils";
import "../subtasks/upgradeContract"


task("upgradePoolMaster", "Deploys a new PoolMaster contract using UUPS upgradeable pattern")
    .addPositionalParam("deployFile", "the file with the deploy data")
    .addPositionalParam("owner", "the address of the owner of the pool. Must be present in .env private keys")
    .setAction(async (taskArgs, hre) => {
        // check deploy file exists
        if (!fs.existsSync(taskArgs.deployFile)) {
            throw new Error("deploy file does not exist")
        }
        const accounts = await hre.ethers.getSigners();
        const owner = getSigner(taskArgs.owner, accounts);
        // const gasPrice = await hre.ethers.getDefaultProvider().getGasPrice()

        let deployData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.deployFile), 'utf8'));

        // ======== UPGRADE POOL MASTER CONFIG ===========
        console.log("creating new deploy for PoolMasterConfig...")
        let newPoolMasterConfigLogic = await deployerContract(
            hre, deployData["poolMaster"]["config"]["contract"], {}, false, {}, 
            [
                deployData["storage"]["address"],
                // {
                //     gasPrice: gasPrice.toString(), // gas price from RPC provider
                //     gasLimit: "6660666",
                //   }
            ],
            owner);
        console.log("new PoolMasterConfig deployed to ->", newPoolMasterConfigLogic.address)
        if (!("logic" in deployData["poolMaster"]["config"])){
            deployData["poolMaster"]["config"]["logic"] = []
            let poolMasterConfigProxy = await hre.ethers.getContractAt(
                "LogicProxy", deployData["poolMaster"]["config"]["address"])
            deployData["poolMaster"]["config"]["logic"].push({
                "address": (await poolMasterConfigProxy.functions.getImplementation())[0]
            })
        }

        let args = {
            "logicAddress": newPoolMasterConfigLogic.address,
            "proxyAddress": deployData["poolMaster"]["config"]["address"],
            "owner": taskArgs.owner
        }
        console.log("calling the upgradeContract subtask for PoolMasterConfig...")
        await hre.run("upgradeContract", args)
        console.log("-> done, proxy upgraded logic address")

        deployData["poolMaster"]["config"]["logic"].push({
            "contract": deployData["poolMaster"]["config"]["contract"],
            "address": newPoolMasterConfigLogic.address
        })

        // ========= UPGRADE POOL MASTER DEPLOYER ==================
        console.log("creating new deploy for PoolMasterDeployer...")
        let newPoolMasterDeployerLogic = await deployerContract(
            hre, deployData["poolMaster"]["deployer"]["contract"], {}, false, {}, 
            [
                deployData["storage"]["address"]
            ],
            owner);
        console.log("new PoolMasterDeployer deployed to ->", newPoolMasterDeployerLogic.address)
        if (!("logic" in deployData["poolMaster"]["deployer"])){
            deployData["poolMaster"]["deployer"]["logic"] = []
            let poolMasterDeployerProxy = await hre.ethers.getContractAt(
                "LogicProxy", deployData["poolMaster"]["deployer"]["address"])
            deployData["poolMaster"]["deployer"]["logic"].push({
                "address": (await poolMasterDeployerProxy.functions.getImplementation())[0]
            })
        }

        args = {
            "logicAddress": newPoolMasterDeployerLogic.address,
            "proxyAddress": deployData["poolMaster"]["deployer"]["address"],
            "owner": taskArgs.owner
        }
        console.log("calling the upgradeContract subtask for PoolMasterDeployer...")
        await hre.run("upgradeContract", args)
        console.log("-> done, proxy upgraded logic address")

        deployData["poolMaster"]["deployer"]["logic"].push({
            "contract": deployData["poolMaster"]["deployer"]["contract"],
            "address": newPoolMasterDeployerLogic.address
        })

        fs.writeFileSync(taskArgs.deployFile, JSON.stringify(deployData, null, 2))
    })