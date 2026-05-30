import { task } from "hardhat/config";
import * as path from 'path';
import fs from 'fs';
import "../subtasks/deployPoolLogic"
import "../subtasks/pmcAddNewLogic"

/**
 * Deploys DistributionPoolV2 (lazy pull-based distribution) as a new logic
 * version in an existing PoolMasterConfig. After this runs, newly created
 * pools use V2 automatically (PoolMaster always picks the latest version).
 * Existing pools are NOT touched.
 *
 * Usage:
 *   npx hardhat deployPoolV2Version deploys/deploy_base_sepolia_testnet.json --network basesepolia
 */
task("deployPoolV2Version", "Deploys DistributionPoolV2 as a new logic version")
    .addPositionalParam("deployFile", "Path to the deploy file")
    .setAction(async (taskArgs, hre) => {
        if (!fs.existsSync(taskArgs.deployFile)) {
            throw new Error("deploy file does not exist")
        }

        let deployData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.deployFile), 'utf8'));

        console.log("run subtask deployPoolLogic (DistributionPoolV2)...")
        let result1 = await hre.run("deployPoolLogic", {
            "storageAddress": deployData["storage"]["address"],
            "deployerAddress": deployData["poolMaster"]["owner"],
            "contract": "DistributionPoolV2"
        })
        console.log("run subtask pmcAddNewLogic...")
        let result2 = await hre.run("pmcAddNewLogic", {
            "pmcAddress": deployData["poolMaster"]["config"]["address"],
            "owner": deployData["poolMaster"]["owner"],
            "logicAddress": result1["logic"],
            "logicName": result1["contract"],
            "pmcContract": deployData["poolMaster"]["config"]["contract"]
        })

        deployData["poolLogic"].push({
            "address": result1["logic"],
            "versionNumber": result2["versionNumber"]
        })
        fs.writeFileSync(taskArgs.deployFile, JSON.stringify(deployData, null, 2))
        console.log(`DistributionPoolV2 registered as version ${result2["versionNumber"]} at ${result1["logic"]}`)
    })
