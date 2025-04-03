import { subtask } from "hardhat/config";
import fs from 'fs';
import { contractAt, deployerContract } from "../../utils/contract-utils";
import * as path from 'path';
import { getSigner } from "../../utils/simulation-utils";

subtask("upgradeContract", "Upgrade a contract using a new deployed logic address")
    // .addPositionalParam("contractFromName", "the name of the contract to be upgraded")
    .addPositionalParam("logicAddress", "the address of the new deployed logic")
    .addPositionalParam("proxyAddress", "the address of the proxy contract")
    .addPositionalParam("owner", "The address of the owner. Must be present in .env private keys")
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners();
        console.log("getting owner signer")
        const owner = getSigner(taskArgs.owner, accounts);
        console.log("getting proxy contract")
        const proxy = await contractAt(
            hre, "LogicProxy", 
            taskArgs.proxyAddress);
        console.log("attaching logicProxiable abi")
        const pool = await hre.ethers.getContractAt("LogicProxiable", taskArgs.proxyAddress)
        let implementation = (await pool.functions.getImplementation())[0]
        console.log(
            "->logic.attach(proxy) implementation address before:", 
            implementation)
        if (implementation === taskArgs.logicAddress){
            console.log("pool is already using the target version implementation")
        } else {
            let txData = await pool.connect(owner).functions.upgradeTo(taskArgs.logicAddress);
            let txreceipt = await txData.wait()
            console.log(
                "->logic.attach(proxy) implementation address after:", 
                await pool.functions.getImplementation())
        }
    })