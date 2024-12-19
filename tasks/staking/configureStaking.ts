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
        const signer = getSigner(taskArgs.fromAddress, accounts);

        const totalReward = hre.ethers.utils.parseEther(taskArgs.totalReward).toString()
        const lockPeriod = Math.floor(Number(taskArgs.lockPeriod)) * 86400
        const depositPeriod = Math.floor(Number(taskArgs.depositPeriod)) * 86400
        const startDate = Math.floor(Number(taskArgs.startDate))
        const dpr = Math.floor(Number(taskArgs.dpr))
        
        const today = (new Date().getTime())/1000
        if (startDate < today) {
            throw new Error("StartDate cannot be before today");
        }

        console.log("::: CREATING THE FOLLOWING STAKING CONFIGURATION :::")
        console.log("-> staking contract:", data["contract"]["address"])
        console.log("-> total Rewards (wei): ", totalReward)
        console.log("-> Lock period (seconds):", lockPeriod)
        console.log("-> deposit period (seconds):", depositPeriod)
        console.log("-> start Date (epoch):", startDate)
        console.log("-> DPR (percent):", dpr/100000)
        console.log("==-> APR (percent):", dpr * 365 / 100000)
        console.log("==-> total rewards percent over the lock period:", lockPeriod * dpr / (100000 * 86400))
        
        // get staking contract
        const staking = await contractAt(
            hre, "LockedStaking", 
            data["contract"]["address"]);

        // set the configuration
        let tx = await staking.connect(signer)
            .functions.setStakingConfig({
                "dprOver10kk": dpr,
                "tokensForRewards": totalReward,
                "lockPeriodDuration": lockPeriod,
                "depositPeriodDuration": depositPeriod,
                "startDate": startDate
            })
        let res = await tx.wait()
        
    })