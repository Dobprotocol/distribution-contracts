import { subtask, task } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "../utils/contract";
import { getSigner } from "../utils/account";
import * as path from 'path';


/*
"initialConfig": {
        "dprOver10kk": "2740",
        "tokensForRewards": "10000000000000000000",
        "lockPeriodDuration": 691200,
        "depositPeriodDuration": 432000,
        "startDate": 1721252913
    }
*/

task("configureSimpleStaking", "task to configure a new  locked staking setting.")
    .addPositionalParam(
        "outputFile", 
        "The output file produced from the deploy. The owner of the contract must match the private key from .env")
    .addOptionalParam("lockPeriod", "the lock period for this staking configuration. In days (integer)")
    .addOptionalParam("depositPeriod", "The deposit period (when it is allowed to deposit funds) for this staking configuration. In Days (integer)")
    .addOptionalParam("startDate", "the start date for this configuration. It will mark the date where the deposit period starts. In epoch in seconds (integer).")
    .addOptionalParam("rewardRate", "final reward rate of the staking, factor multiplied by 10000. For example a reward rate of 0.01 (1%) would be 100")
    .setAction(async (taskArgs, hre) => {
        const now = new Date();
        let outputConfigFile = path.join(
            __dirname, "deploys",
            taskArgs.outputFile);
        let data = JSON.parse(fs.readFileSync(
            path.join(outputConfigFile), 'utf8'));
        
        const accounts = await hre.ethers.getSigners();
        const signer = getSigner(data["contract"]["owner"], accounts);
        const lockPeriod = Math.floor(Number(taskArgs.lockPeriod))
        const depositPeriod = Math.floor(Number(taskArgs.depositPeriod))
        const startDate = Math.floor(Number(taskArgs.startDate))
        let humanStartDate = new Date(0)
        humanStartDate.setUTCSeconds(startDate)
        const rewardRate = Math.floor(Number(taskArgs.rewardRate))
        
        const today = (new Date().getTime())/1000
        if (startDate < today) {
            throw new Error("StartDate cannot be before today");
        }



        console.log("::: THE FOLLOWING STAKING CONFIGURATION WILL BE CREATED:::")
        console.log("-> staking contract:", data["contract"]["address"])
        console.log("-> Lock period (days):", lockPeriod, )
        console.log("-> deposit period (days):", depositPeriod,)
        console.log("-> start Date (epoch):", startDate, "| human:", humanStartDate)
        console.log("-> reward rate (factor):", rewardRate/10000)
        console.log("==-> total rewards percent over the lock period:", rewardRate/100)
        console.log(":::: YOU HAVE 30 SECONDS TO CANCEL THIS CONFIGURATION ::::")
        await new Promise(f => setTimeout(f, 30000));
        console.log("\nEXECUTING CONFIGURATION...")
        
        // get staking contract
        const staking = await contractAt(
            hre, "SimpleLockedStaking", 
            data["contract"]["address"]);

        // set the configuration

        const config = {
            "rewardRate": rewardRate,
            "lockPeriodDuration": lockPeriod,
            "depositPeriodDuration": depositPeriod,
            "startDate": startDate
        }

        let tx = await staking.connect(signer)
            .functions.setConfig(config)
        let res = await tx.wait()

        // save to file
        data["configurations"].push(config)
        fs.writeFileSync(outputConfigFile, JSON.stringify(data, null, 2))
    })