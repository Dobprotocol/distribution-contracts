import { subtask } from "hardhat/config";
import fs from 'fs';
import { deployerContract } from "./utils/contract-utils";
import * as path from 'path';
import { checkCreatorAddress } from "./utils/deploy-utils";

subtask("deployStorage", "Deploy a new storage")
    .addPositionalParam("outputConfigFile", "the path to the config file where all the address will be stored")
    .addPositionalParam("inputConfigFile", "Path to input config to use")
    .setAction(async (taskArgs, hre) =>{
        console.log("Deploy storage...")
        const accounts = await hre.ethers.getSigners();
        console.log("-->ACCOUNTS LENGTH:", accounts.length);
        let inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.inputConfigFile), 'utf8'));
        if (!checkCreatorAddress(accounts,inData)){
            throw Error("creator address does not match")
        }
        let storage = await deployerContract(
            hre, inData["contracts"]["storage"], {}, false, {}, 
            [], 
            accounts[inData["addressIds"]["creator"]]);

        console.log("-->storage:", storage.address)
        var data = {
            "storage": {
                "address": storage.address,
                "contract": inData["contracts"]["storage"],
                "owner": accounts[inData["addressIds"]["creator"]].address
            }
        }
        fs.writeFileSync(taskArgs.outputConfigFile, JSON.stringify(data, null, 2))
    })