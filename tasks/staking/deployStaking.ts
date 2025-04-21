import { subtask, task } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "../utils/contract";
import { getSigner } from "../utils/account";
import * as path from 'path';

task("deployStaking", "task to deploy the smart contract to manage locked staking.")
    .addPositionalParam(
        "deployerAddress", 
        "The address of the deployer wallet. This will be compared to the private key stored in .env file and checked")
    .addPositionalParam("stakeToken", "The address of the ERC20 token to stake")
    .addPositionalParam("rewardToken", "The address of the ERC20 token to reward")
    .addOptionalParam("outputFile", "the output file. If not set, a default name with a timestamp will be used", "")
    .setAction(async (taskArgs, hre) => {
        const now = new Date();
        let outFilename = taskArgs.outputFile === "" ? "output_" + now.toISOString() + "_locked_stacking.json" : taskArgs.outputFile;
        let outputConfigFile = path.join(
            __dirname, "deploys",
            outFilename);
        
        const accounts = await hre.ethers.getSigners();
        const signer = getSigner(taskArgs.deployerAddress, accounts);
        
        // deploy contract
        console.log("deploy arrayBytes32 library...")
        let arrayLibrary = await deployerContract(
            hre, "ArrayBytes32", {}, false, {}, [], accounts[0]
        )
        console.log("deploy LockedStaking contract...")
        let lockedStaking = await deployerContract(
            hre, "LockedStaking", {"ArrayBytes32": arrayLibrary.address}, false, {},
            [
                taskArgs.stakeToken,
                taskArgs.rewardToken
            ], signer);
        console.log("deployed contract address is:", lockedStaking.address)
        // write output file
        let data = {
            "contract": {
                "address": lockedStaking.address,
                "tokens": {
                    "stake": taskArgs.stakeToken,
                    "reward": taskArgs.rewardToken
                },
                "owner": signer.address,
            },
            "configurations": []
        }
        console.log("writing data", data)
        fs.writeFileSync(outputConfigFile, JSON.stringify(data, null, 2))
        
    })