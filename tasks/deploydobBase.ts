import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import "./subtasks/deployLogic";
import "./subtasks/deployPoolMaster";
import "./subtasks/deployStorage";
import "./subtasks/deployTreasuryPool";
import "./subtasks/deployTokenSaleMarket";
import "./subtasks/transferOnwership";
import { checkCreatorAddress } from "./subtasks/utils/deploy-utils";


// task to deploy simulations for tokenPools
// address id asignations:
// 0: creator addres and external token owner address
// [1,9]: pool participants
// for basic test we have:
// - 1,2 [80,20]: treshory participants
// - 3,4 [70,30]: daily pool participants
// - 4,5,6,7 [5, 20, 60, 15]: weekly pool participants
// - 7,8,9 [1, 50, 49]: montly pool participants
// same configuration will be used for ETH-pools and TOKEN-pools
// this configuration can be found in simulations/configs/basic_simulation.json
// please run this task as follow:
// npx hardhat --network demoDob deployContractss basic_simulation_deploy1.json --simulation-config basic_simulation.json
// or if you already have a pool master, use:
// npx hardhat --network demoDob deployContracts basic_simulation_deploy1.json --pool-master-address <PMAddress> --simulation-config basic_simulation.json

task("deployDobBase", "A task to deploy base contracts for Dob enviroment")
    .addOptionalParam("outputConfigTag", "tag used to identify output files", "dobBase")
    .addOptionalParam("outputConfigFile", "Name of the output config to use", "None")
    .addOptionalParam("inputConfigFile", "Name of the input config to use", "dob_base.json")
    .setAction(async (taskArgs, hre) =>{
        const now = new Date();
        let outputConfigFile;
        if (taskArgs.outputConfigFile != "None"){
            outputConfigFile=path.join(
                __dirname, "deploys", 
                taskArgs.outputConfigFile);
        } else {
            outputConfigFile = path.join(
                __dirname, "deploys", 
                "output_" + now.toISOString() + "_" + taskArgs.outputConfigTag + ".json");
        }
        let inputConfigFile = path.join(
            __dirname, "configs", 
            taskArgs.inputConfigFile);
        console.log(":::: OUT FILE ", outputConfigFile, " :::::");
        let argFiles = {
            "outputConfigFile": outputConfigFile,
            "inputConfigFile": inputConfigFile
        }
        let inData = JSON.parse(fs.readFileSync(
            path.join(inputConfigFile), 'utf8'));
        const accounts = await hre.ethers.getSigners();
        if (!checkCreatorAddress(accounts,inData)){
            console.log("trowing error")
            throw new Error("creator address does not match")
        }

        await hre.run("deployStorage", argFiles)
        await new Promise(f => setTimeout(f, 1000));
        await hre.run("deployPoolMaster", argFiles)
        await new Promise(f => setTimeout(f, 1000));
        await hre.run("deployLogic", argFiles)
        await new Promise(f => setTimeout(f, 1000));
        await hre.run("deployTreasuryPool", argFiles)
        await new Promise(f => setTimeout(f, 1000));
        await hre.run("deployTokenSaleMarket", argFiles)
        await new Promise(f => setTimeout(f, 1000));
        await hre.run("transferOwnership", argFiles)
    })