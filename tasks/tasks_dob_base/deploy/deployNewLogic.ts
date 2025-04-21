import { task } from "hardhat/config";
import * as path from 'path';
import fs from 'fs';
import "../subtasks/deployLogic";


task("deployNewLogic", "Deploys a new logic contract and link it to poolMasterConfig")
    .addPositionalParam("configFile", "Path to the config file used for the deploy")
    .addPositionalParam("deployFile", "Path to the deploy file")
    .setAction(async (taskArgs, hre) => {
        // check files exsits
        if (!fs.existsSync(taskArgs.deployFile)){
            throw new Error("deploy file does not exist")
        }
        if (!fs.existsSync(taskArgs.configFile)){
            throw new Error("config file does not exist")
        }

        let argFiles = {
            "outputConfigFile": taskArgs.deployFile,
            "inputConfigFile": taskArgs.configFile
        }
        console.log("calling subtask deployLogic")
        await hre.run("deployLogic", argFiles)
    })