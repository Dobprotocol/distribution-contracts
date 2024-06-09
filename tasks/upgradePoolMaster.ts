import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import "./subtasks/deployLogic";
import "./subtasks/deployPoolMaster";
import "./subtasks/deployStorage";
import "./subtasks/deployTreasuryPool";
import "./subtasks/deployTokenSaleMarket";
import { contractAt, deployerContract, upgradeContract } from "./subtasks/utils/contract-utils";


task("upgradePoolMaster", "Deploys a new PoolMaster contract using UUPS upgradeable pattern")
    .addOptionalParam("outputConfigFile", "tag used to identify output files", "dobBase.json")
    .addOptionalParam("inputConfigFile", "Name of the input config to use", "dob_base.json")
    .addOptionalParam("owner", "the address of the owner of the pool", "none")
    .setAction(async (taskArgs, hre) => {
        let outputConfigFile = path.join(
            __dirname, "deploys", 
            taskArgs.outputConfigFile);
        let inputConfigFile = path.join(
            __dirname, "configs", 
            taskArgs.inputConfigFile);
        const accounts = await hre.ethers.getSigners();

        let inData = JSON.parse(fs.readFileSync(
            path.join(inputConfigFile), 'utf8'));
        let outData = JSON.parse(fs.readFileSync(
            path.join(outputConfigFile), 'utf8'));

        // ======== UPGRADE POOL MASTER CONFIG ===========
        let newPoolMasterConfigLogic = await deployerContract(
            hre, inData["contracts"]["poolMasterConfig"], {}, false, {}, 
            [
                outData["storage"]["address"]
            ],
            accounts[inData["addressIds"]["creator"]]);

        if (!("logic" in outData["poolMaster"]["config"])){
            outData["poolMaster"]["config"]["logic"] = []
            let poolMasterConfigProxy = await hre.ethers.getContractAt(
                "LogicProxy", outData["poolMaster"]["config"]["address"])
            outData["poolMaster"]["config"]["logic"].push({
                "address": (await poolMasterConfigProxy.functions.getImplementation())[0]
            })
        }

        let args = {
            "logicAddress": newPoolMasterConfigLogic.address,
            "proxyAddress": outData["poolMaster"]["config"]["address"],
            "owner": taskArgs.owner
        }
        await hre.run("upgradeContract", args)

        outData["poolMaster"]["config"]["logic"].push({
            "contract": inData["contracts"]["poolMasterConfig"],
            "address": newPoolMasterConfigLogic.address
        })

        // ========= UPGRADE POOL MASTER DEPLOYER ==================

        let newPoolMasterDeployerLogic = await deployerContract(
            hre, inData["contracts"]["poolMasterDeployer"], {}, false, {}, 
            [
                outData["storage"]["address"]
            ],
            accounts[inData["addressIds"]["creator"]]);

        if (!("logic" in outData["poolMaster"]["deployer"])){
            outData["poolMaster"]["deployer"]["logic"] = []
            let poolMasterDeployerProxy = await hre.ethers.getContractAt(
                "LogicProxy", outData["poolMaster"]["deployer"]["address"])
            outData["poolMaster"]["deployer"]["logic"].push({
                "address": (await poolMasterDeployerProxy.functions.getImplementation())[0]
            })
        }

        args = {
            "logicAddress": newPoolMasterDeployerLogic.address,
            "proxyAddress": outData["poolMaster"]["deployer"]["address"],
            "owner": taskArgs.owner
        }
        await hre.run("upgradeContract", args)

        outData["poolMaster"]["deployer"]["logic"].push({
            "contract": inData["contracts"]["poolMasterDeployer"],
            "address": newPoolMasterDeployerLogic.address
        })

        fs.writeFileSync(outputConfigFile, JSON.stringify(outData, null, 2))
    })