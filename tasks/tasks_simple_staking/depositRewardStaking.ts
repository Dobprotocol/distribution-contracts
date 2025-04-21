import { subtask, task } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "../utils/contract";
import { getSigner } from "../utils/account";
import * as path from 'path';

task("depositRewardSimpleStaking", "task to deposit reward tokens to the locked staking smart contract.")
    .addPositionalParam(
        "outputFile", 
        "The output file produced from the deploy.")
    .addPositionalParam("fromAddress", "the address from where the tokens will be transferred. Must match the private key from .env")
    .addPositionalParam("amount", "the amount to transfer, in ethers")
    .setAction(async (taskArgs, hre) => {
        const now = new Date();
        let outputConfigFile = path.join(
            __dirname, "deploys",
            taskArgs.outputFile);
        let data = JSON.parse(fs.readFileSync(
            path.join(outputConfigFile), 'utf8'));
        
        const accounts = await hre.ethers.getSigners();
        const signer = getSigner(taskArgs.fromAddress, accounts);
        const amount = hre.ethers.utils.parseEther(taskArgs.amount).toString()
        
        // get erc20 contract
        let token = await contractAt(hre, "ERC20", data["contract"]["tokens"]["reward"])

        // deposit
        let tx = await token.connect(signer)
            .functions.transfer(data["contract"]["address"], amount)
        
        let res = await tx.wait()
        
    })