import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import { contractAt, upgradeContract } from "./subtasks/utils/contract-utils";
import "./subtasks/upgradeContract";

task("upgradePool", "Upgrade a pool logic to a new implementation")
    .addOptionalParam("outputConfigFile", "tag used to identify output files", "dobBase.json")
    .addOptionalParam("poolAddress", "the address of the pool to be upgraded", "none")
    .addOptionalParam("logicVersion", "specify the logic version to use", "1")
    .addOptionalParam("owner", "the address of the owner of the pool", "none")
    .setAction(async (taskArgs, hre) => {
        let outputConfigFile = path.join(
            __dirname, "deploys", 
            taskArgs.outputConfigFile);

        let outData = JSON.parse(fs.readFileSync(
            path.join(outputConfigFile), 'utf8'));

        const poolMasterConfig = await contractAt(
            hre, outData["poolMaster"]["config"]["contract"], 
            outData["poolMaster"]["config"]["address"]);
        let logicAddress;
        let logicContract;
        await poolMasterConfig.functions.getLogicVersion(taskArgs.logicVersion)
            .then((res) => {
                logicAddress = res._logic;
                logicContract = res._name;
            })
        console.log("the logic version", taskArgs.logicVersion, " address is", logicAddress)
        let args = {
            "logicAddress": logicAddress,
            "proxyAddress": taskArgs.poolAddress,
            "owner": taskArgs.owner
        }
        console.log("call subtask upgradeContract...")
        await hre.run("upgradeContract", args)

    })