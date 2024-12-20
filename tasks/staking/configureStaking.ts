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

task("configureStaking", "task to configure a new  locked staking setting.")
    .addPositionalParam(
        "outputFile", 
        "The output file produced from the deploy. The owner of the contract must match the private key from .env")
    .addOptionalParam("totalReward", "the total reward amount fo set for this configuration. In ethers")
    .addOptionalParam("lockPeriod", "the lock period for this staking configuration. In days (integer)")
    .addOptionalParam("depositPeriod", "The deposit period (when it is allowed to deposit funds) for this staking configuration. In Days (integer)")
    .addOptionalParam("startDate", "the start date for this configuration. It will mark the date where the deposit period starts. In epoch in seconds (integer).")
    .addOptionalParam("dpr", "Daily percentage rate, percentage multiplied by 100000. For example a dpr of 0.1% would be 10000")
    .setAction(async (taskArgs, hre) => {
        const now = new Date();
        let outputConfigFile = path.join(
            __dirname, "deploys",
            taskArgs.outputFile);
        let data = JSON.parse(fs.readFileSync(
            path.join(outputConfigFile), 'utf8'));
        
        const accounts = await hre.ethers.getSigners();
        const signer = getSigner(data["contract"]["owner"], accounts);
        const dayInSeconds = 86400
        const totalReward = hre.ethers.utils.parseEther(taskArgs.totalReward).toString()
        const lockPeriod = Math.floor(Number(taskArgs.lockPeriod)) * dayInSeconds
        const depositPeriod = Math.floor(Number(taskArgs.depositPeriod)) * dayInSeconds
        const startDate = Math.floor(Number(taskArgs.startDate))
        let humanStartDate = new Date(0)
        humanStartDate.setUTCSeconds(startDate)
        const dpr = Math.floor(Number(taskArgs.dpr))
        
        const today = (new Date().getTime())/1000
        if (startDate < today) {
            throw new Error("StartDate cannot be before today");
        }



        console.log("::: THE FOLLOWING STAKING CONFIGURATION WILL BE CREATED:::")
        console.log("-> staking contract:", data["contract"]["address"])
        console.log("-> total Rewards (wei): ", totalReward, "| ether:", taskArgs.totalReward)
        console.log("-> Lock period (seconds):", lockPeriod, "| days:", lockPeriod/dayInSeconds)
        console.log("-> deposit period (seconds):", depositPeriod, " | days:", depositPeriod/dayInSeconds)
        console.log("-> start Date (epoch):", startDate, "| human:", humanStartDate)
        console.log("-> DPR (percent):", dpr/100000)
        console.log("==-> total rewards percent over the lock period:", lockPeriod * dpr / (100000 * dayInSeconds))
        console.log(":::: YOU HAVE 30 SECONDS TO CANCEL THIS CONFIGURATION ::::")
        await new Promise(f => setTimeout(f, 30000));
        console.log("\nEXECUTING CONFIGURATION...")
        
        // get staking contract
        const staking = await contractAt(
            hre, "LockedStaking", 
            data["contract"]["address"]);

        // set the configuration
        const config = {
            "dprOver10kk": dpr,
            "tokensForRewards": totalReward,
            "lockPeriodDuration": lockPeriod,
            "depositPeriodDuration": depositPeriod,
            "startDate": startDate
        }

        let tx = await staking.connect(signer)
            .functions.setStakingConfig(config)
        let res = await tx.wait()

        // save to file
        data["configurations"].push(config)
        fs.writeFileSync(outputConfigFile, JSON.stringify(data, null, 2))
    })