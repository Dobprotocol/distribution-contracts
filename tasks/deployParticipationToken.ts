import { subtask, task } from "hardhat/config";
import fs from 'fs';
import { deployerContract } from "./subtasks/utils/contract-utils";
import * as path from 'path';

task("deployParticipationToken", "task to deploy a participationToken (ERC20) with 18 decimals")
    .addPositionalParam("deployerPriv", "Private key for the address that will deploy and mint the tokens")
    .addPositionalParam("supply", "the supply to mint, in ether")
    .addOptionalParam("supplyOwner", "The supply owner for the minted supply. By default it will be the deployerPriv", "")
    .addOptionalParam("name", "the name for the ERC20", "ParticipationToken")
    .addOptionalParam("symbol", "the symbol for the ERC20", "PTT")
    .addOptionalParam("showTxRes", "wether to show or not the tx results", "false")
    .setAction(async (taskArgs, hre) => {
        const provider = hre.ethers.provider
        const signer = new hre.ethers.Wallet(taskArgs.deployerPriv, provider)
        const supply = hre.ethers.utils.parseEther(taskArgs.supply)
        const supplyOwner = taskArgs.supplyOwner === "" ? signer.address : taskArgs.supplyOwner
        const name = taskArgs.name
        const symbol = taskArgs.symbol
        const showTxRes = taskArgs.showTxRes === "true"
        console.log("::::: inputs for deploy the ERC20 token ::::")
        console.log("-> deployer address:", signer.address)
        console.log("-> supply to mint (wei):", supply.toString())
        console.log("-> supply owner:", supplyOwner)
        console.log("-> token name:", name)
        console.log("-> token symbol:", symbol)
        console.log(":::::::::::::::::::::::::::::::")

        console.log("1. deploy token")
        let dobToken = await deployerContract(
            hre, "ParticipationToken", {}, false, {},
            [
                name,
                symbol
            ], signer);
        console.log("=> participation token address is:", dobToken.address);
        console.log("2. mint supply")
        let tx = await dobToken.connect(signer)
            .functions.mint_single_owner(
                supply,
                supplyOwner,
                false
            )
        if (showTxRes){
            console.log("-> tx:", tx)
        }
        let data = await tx.wait()
        if (showTxRes){
            console.log("-> tx res data:", data)
        }
        console.log("=> tokens minted")
    })