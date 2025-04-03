import { subtask } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "../../utils/contract-utils";
import * as path from 'path';
import { checkCreatorAddress } from "../../utils/deploy-utils";
import { error } from "console";

subtask("transferOwnership", "transfer ownership of poolmaster and storage")
    .addPositionalParam("outputConfigFile", "the path to the config file where all the address will be stored")
    .addPositionalParam("inputConfigFile", "Path to input config to use")
    .setAction(async (taskArgs, hre) =>{
        console.log("Deploy PoolMaster...")
        const accounts = await hre.ethers.getSigners();
        console.log("->ACCOUNTS LENGTH:", accounts.length);
        let inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.inputConfigFile), 'utf8'));
        let outData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.outputConfigFile), 'utf8'));
        if (!checkCreatorAddress(accounts,inData)){
            throw Error("creator address does not match")
        }
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
        let txData;
        let resData;
        console.log("transfer ownership for pmDeployer to", inData["addressIds"]["storageOwner"])
        txData = await pmdeployer.connect(accounts[inData["addressIds"]["creator"]])
            .transferOwnership(inData["addressIds"]["storageOwner"])
        resData = await txData.wait()

        console.log("transfer ownership for pmConfig to", inData["addressIds"]["storageOwner"])
        txData = await pmconfig.connect(accounts[inData["addressIds"]["creator"]])
            .transferOwnership(inData["addressIds"]["storageOwner"])
        resData = await txData.wait()
        outData["poolMaster"]["owner"] = inData["addressIds"]["storageOwner"]

        console.log("transfer ownership for storage to", inData["addressIds"]["storageOwner"])
        txData = await storage.connect(accounts[inData["addressIds"]["creator"]])
            .setGuardian(inData["addressIds"]["storageOwner"])
        resData = await txData.wait()
        outData["storage"]["owner"] = inData["addressIds"]["storageOwner"]
    })