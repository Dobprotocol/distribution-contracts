import { subtask, task } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "./subtasks//utils/contract-utils";
import * as path from 'path';

task("deployDobLockedStaking", "task to deploy the smart contract to manage locked staking")
    .addOptionalParam("deployConfig", "the deploy config", "dob_locked_staking.json")
    .addOptionalParam("outputConfigTag", "tag used to identify output files", "lockedStaking")
    .setAction(async (taskArgs, hre) => {
        const now = new Date();
        let outputConfigFile = path.join(
            __dirname, "deploys",
            "output_" + now.toISOString() + "_" + taskArgs.outputConfigTag + ".json");
        let inputConfigFile = path.join(
                __dirname, "configs",
                taskArgs.deployConfig);

        const accounts = await hre.ethers.getSigners();
        let inData = JSON.parse(fs.readFileSync(
            path.join(inputConfigFile), 'utf8'));
        
        // deploy contract
        console.log("deploy arrayBytes32 library...")
        let arrayLibrary = await deployerContract(
            hre, "ArrayBytes32", {}, false, {}, [], accounts[inData["deployerId"]]
        )
        console.log("deploy LockedStaking contract...")
        let lockedStaking = await deployerContract(
            hre, "LockedStaking", {"ArrayBytes32": arrayLibrary.address}, false, {},
            [
                inData["token"],
                inData["token"]
            ], accounts[inData["deployerId"]]);
        
        // deposit tokens to contract
        console.log("deposit tokens to contract...")
        let token = await contractAt(hre, "ERC20", inData["token"])
        await token.connect(accounts[inData["deployerId"]])
            .functions.transfer(lockedStaking.address, inData["initialBalance"])

        console.log("... wait 5 seconds")
        await new Promise(f => setTimeout(f, 5000));
        console.log("create an initial configuration for staking...")
        // create the initial config
        await lockedStaking.connect(accounts[inData["deployerId"]])
            .functions.setStakingConfig(inData["initialConfig"])
        console.log("transfer ownership...")
        // transfer ownership
        await lockedStaking.connect(accounts[inData["deployerId"]])
            .functions.transferOwnership(inData["owner"])

    })