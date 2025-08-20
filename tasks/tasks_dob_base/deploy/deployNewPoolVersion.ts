import { task } from "hardhat/config";
import * as path from 'path';
import fs from 'fs';
import "../subtasks/deployPoolLogic"
import "../subtasks/pmcAddNewLogic"



task("deployNewPoolVersion", "Deploys a new Pool logic version in the PoolMasterConfig")
    .addPositionalParam("deployFile", "Path to the deploy file")
    .setAction(async (taskArgs, hre) => {
        // check deploy file exists
        if (!fs.existsSync(taskArgs.deployFile)) {
            throw new Error("deploy file does not exist")
        }
        
        let deployData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.deployFile), 'utf8'));

        // deploy a new pool logic
        console.log("run subtask deployPoolLogic...")
        let result1 = await hre.run("deployPoolLogic", {
            "storageAddress": deployData["storage"]["address"],
            "deployerAddress": deployData["poolMaster"]["owner"],
            "contract": "DistributionPool"
        })
        console.log("run subtask pmcAddNewLogic...")
        let result2 = await hre.run("pmcAddNewLogic", {
            "pmcAddress": deployData["poolMaster"]["config"]["address"],
            "owner": deployData["poolMaster"]["owner"],
            "logicAddress": result1["logic"],
            "logicName": result1["contract"],
            "pmcContract": deployData["poolMaster"]["config"]["contract"]
        })

        // update data in deploy file
        deployData["poolLogic"].push({
            "address": result1["logic"],
            "versionNumber": result2["versionNumber"]
        })
        // write
        fs.writeFileSync(taskArgs.deployFile, JSON.stringify(deployData, null, 2))

    })