import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import "./subtasks/deployLogic";
import "./subtasks/deployPoolMaster";
import "./subtasks/deployStorage";
import "./subtasks/deployTreasuryPool";
import "./subtasks/deployTokenSaleMarket";
import { contractAt } from "./subtasks/utils/contract-utils";


task("deployNewLogic", "Deploys a new logic contract and link it to poolMasterConfig")
    .addOptionalParam("outputConfigFile", "tag used to identify output files", "dobBase.json")
    .addOptionalParam("inputConfigFile", "Name of the input config to use", "dob_base.json")
    .setAction(async (taskArgs, hre) => {
        let outputConfigFile = path.join(
            __dirname, "deploys", 
            taskArgs.outputConfigFile);
        let inputConfigFile = path.join(
            __dirname, "configs", 
            taskArgs.inputConfigFile);

        let argFiles = {
            "outputConfigFile": outputConfigFile,
            "inputConfigFile": inputConfigFile
        }
        console.log("calling subtash deployLogic")
        await hre.run("deployLogic", argFiles)
    })