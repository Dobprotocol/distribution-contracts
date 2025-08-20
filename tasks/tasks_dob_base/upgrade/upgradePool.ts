import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import { contractAt } from "../../utils/contract-utils";
import "../subtasks/upgradeContract";

task("upgradePool", "Upgrade a pool logic to a new implementation")
    .addPositionalParam("deployFile", "Path to the deploy file")
    .addOptionalParam("poolAddress", "the address of the pool to be upgraded", "none")
    .addOptionalParam("logicVersion", "specify the logic version to use", "1")
    .addOptionalParam("owner", "the address of the owner of the pool", "none")
    .setAction(async (taskArgs, hre) => {
        // check deploy file exists
        if (!fs.existsSync(taskArgs.deployFile)) {
            throw new Error("deploy file does not exist")
        }

        let outData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.deployFile), 'utf8'));

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