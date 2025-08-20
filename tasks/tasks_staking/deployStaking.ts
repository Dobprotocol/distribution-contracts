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
    .addOptionalParam("outputFile", "Path to the output config file. By default uses tasks/outputs/deployStaking/output_<datetime>.json", "")
    .setAction(async (taskArgs, hre) => {
        const now = new Date();
        const defaultOutputFolder = path.join(path.dirname(path.dirname(__dirname)), "outputs", "deployStaking")
        // check output file
        let outputFile;
        if (taskArgs.outputFile === ""){
            outputFile=path.join(defaultOutputFolder, `output_${now.toISOString()}.json`);
        } else {
            outputFile = taskArgs.outputFile;
        }
        // check if output folder exists, if not, create
        if (!fs.existsSync(path.dirname(outputFile))){
            console.log("creating", path.dirname(outputFile))
            fs.mkdirSync(path.dirname(outputFile), {recursive: true});
        }
        
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
        fs.writeFileSync(outputFile, JSON.stringify(data, null, 2))
        
    })