import { subtask } from "hardhat/config";
import fs from 'fs';
import { deployerContract } from "../../utils/contract-utils";
import * as path from 'path';
import { getSigner } from "../../utils/simulation-utils";

subtask("deployStorage", "Deploy a new storage")
    .addPositionalParam("outputConfigFile", "the path to the config file where all the address will be stored")
    .addPositionalParam("inputConfigFile", "Path to input config to use")
    .addPositionalParam("creatorAddress", "The address that will deploy the contracts. Must match the private key from .env file")
    .setAction(async (taskArgs, hre) =>{
        console.log("Deploy storage...")
        const accounts = await hre.ethers.getSigners();
        const creator = await getSigner(taskArgs.creatorAddress, accounts);
        let inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.inputConfigFile), 'utf8'));
        let storage = await deployerContract(
            hre, inData["contracts"]["storage"], {}, false, {}, 
            [], 
            creator);

        console.log("-->storage:", storage.address)
        var data = {
            "network": hre.network.name,
            "storage": {
                "address": storage.address,
                "contract": inData["contracts"]["storage"],
                "owner": creator.address
            }
        }
        fs.writeFileSync(taskArgs.outputConfigFile, JSON.stringify(data, null, 2))
    })