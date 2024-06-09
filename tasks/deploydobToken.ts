import { subtask, task } from "hardhat/config";
import fs from 'fs';
import { deployerContract } from "./subtasks//utils/contract-utils";
import * as path from 'path';

task("deployDobToken", "task to deploy the ERC20 Dob Token and its timeLock contract")
    .addOptionalParam("deployConfig", "the deploy config", "dob_token.json")
    .addOptionalParam("outputConfigTag", "tag used to identify output files", "dobToken")
    .setAction(async (taskArgs, hre) => {
        const now = new Date();
        let outputConfigFile = path.join(
            __dirname, "deploys",
            "output_" + now.toISOString() + "_" + taskArgs.outputConfigTag + ".json");
        let inputConfigFile = path.join(
            __dirname, "configs",
            taskArgs.deployConfig);

        const accounts = await hre.ethers.getSigners();
        let inData = JSON.parse(fs.readFileSync(
            path.join(inputConfigFile), 'utf8'));

        let dobToken = await deployerContract(
            hre, "DobToken", {}, false, {},
            [
                inData["token"]["name"],
                inData["token"]["symbol"]
            ], accounts[inData["deployerAddressId"]]);
        console.log("dob token is:", dobToken.address);
        let res = await dobToken.connect(accounts[inData["deployerAddressId"]])
            .functions.mint_supply(
                inData["token"]["supplyOwner"], 
                inData["token"]["supply"]
            )
        let data = await res.wait()
        console.log("tokens minted, tx", data)
        // console.log("a second mint should fail, just a check")
        // await dobToken.connect(accounts[inData["deployerAddressId"]])
        //     .functions.mint_supply(
        //         inData["token"]["supplyOwner"], 
        //         inData["token"]["supply"]
        //     )
    })