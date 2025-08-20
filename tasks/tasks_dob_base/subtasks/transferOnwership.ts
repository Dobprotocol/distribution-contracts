import { subtask } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "../../utils/contract-utils";
import * as path from 'path';
import { getSigner } from "../../utils/simulation-utils";
import { retryTransaction } from "../../utils/transaction";

subtask("transferOwnership", "transfer ownership of poolmaster and storage")
    .addPositionalParam("outputConfigFile", "the path to the config file where all the address will be stored")
    .addPositionalParam("inputConfigFile", "Path to input config to use")
    .addPositionalParam("creatorAddress", "The address that will deploy the contracts. Must match the private key from .env file")
    .setAction(async (taskArgs, hre) =>{
        console.log("Deploy PoolMaster...")
        const accounts = await hre.ethers.getSigners();
        const creator = getSigner(taskArgs.creatorAddress, accounts);

        let inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.inputConfigFile), 'utf8'));
        let outData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.outputConfigFile), 'utf8'));

        const storage = await contractAt(
            hre, outData["storage"]["contract"], 
            outData["storage"]["address"]);

        const pmconfig = await contractAt(
            hre, outData["poolMaster"]["config"]["contract"],
            outData["poolMaster"]["config"]["address"]
        )

        const pmdeployer = await contractAt(
            hre, outData["poolMaster"]["deployer"]["contract"],
            outData["poolMaster"]["deployer"]["address"]
        )
        console.log("transfer ownership for pmDeployer to", inData["addressIds"]["storageOwner"])
        await retryTransaction(
            () => pmdeployer.connect(creator)
            .transferOwnership(inData["addressIds"]["storageOwner"]),
            "Transfer ownership for pmDeployer"
        )
        console.log("transfer ownership for pmConfig to", inData["addressIds"]["storageOwner"])
        await retryTransaction(
            () => pmconfig.connect(creator)
            .transferOwnership(inData["addressIds"]["storageOwner"]),
            "Transfer ownership for pmConfig"
        )
        outData["poolMaster"]["owner"] = inData["addressIds"]["storageOwner"]

        console.log("transfer ownership for storage to", inData["addressIds"]["storageOwner"])
        await retryTransaction(
            () => storage.connect(creator)
            .setGuardian(inData["addressIds"]["storageOwner"]),
            "Transfer ownership for storage"
        )
        outData["storage"]["owner"] = inData["addressIds"]["storageOwner"]
    })