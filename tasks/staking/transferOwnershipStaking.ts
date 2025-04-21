import { subtask, task } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "../utils/contract";
import { getSigner } from "../utils/account";
import * as path from 'path';

task("transferOwnershipStaking", "task to transfer the ownership of a locked staking smart contract.")
    .addPositionalParam(
        "outputFile", 
        "The output file produced from the deploy. The current owner in the file must match the private key from .env")
    .addPositionalParam("toAddress", "the address of the new owner")
    .setAction(async (taskArgs, hre) => {
        const now = new Date();
        let outputConfigFile = path.join(
            __dirname, "deploys",
            taskArgs.outputFile);
        let data = JSON.parse(fs.readFileSync(
            path.join(outputConfigFile), 'utf8'));
        
        const accounts = await hre.ethers.getSigners();
        const signer = getSigner(data["contract"]["owner"], accounts);
        
        // get contract
        const staking = await contractAt(
            hre, "LockedStaking", 
            data["contract"]["address"]);
        
        if (hre.ethers.utils.isAddress(taskArgs.toAddress)){
            // transfer ownership
            let tx = await staking.connect(signer)
                .functions.transferOwnership(taskArgs.toAddress)

            let res = await tx.wait().then(() => {
                data["contract"]["owner"] = taskArgs.toAddress
                fs.writeFileSync(outputConfigFile, JSON.stringify(data, null, 2))
            })

        } else {
            console.log("toAddress", taskArgs.toAddress, "was invalid, ownership not transferred")
        }
        
    })