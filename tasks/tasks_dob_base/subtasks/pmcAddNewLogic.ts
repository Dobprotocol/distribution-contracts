import { subtask } from "hardhat/config";
import fs from 'fs';
import { contractAt, deployerContract } from "../../utils/contract-utils";
import * as path from 'path';
import { getSigner } from "../../utils/simulation-utils";
import { retryTransaction } from "../../utils/transaction";

subtask("pmcAddNewLogic", "Deploy a new logic for participation pools")
    .addPositionalParam("pmcAddress", "the address of the poolMasterConfig")
    .addPositionalParam("owner", "the address of the owner. Must match the private key from .env file")
    .addPositionalParam("logicAddress", "the new logic address")
    .addPositionalParam("logicName", "the name of the new logic")
    .addOptionalParam("pmcContract", "the contract name of the poolMasterConfig", "PoolMasterConfig")
    .setAction(async (taskArgs, hre) =>{
        console.log("Deploy Pool logic...")
        const accounts = await hre.ethers.getSigners();
        const owner = await getSigner(taskArgs.owner, accounts);

        const pmc = await contractAt(
            hre, taskArgs.pmcContract, 
            taskArgs.pmcAddress);
            
        const { txData, resData } = await retryTransaction(
            () => pmc.connect(owner).addLogic(
                taskArgs.logicAddress,
                taskArgs.logicName
            ),
            "Add new logic to PoolMasterConfig"
        );
        console.log("new logic added, hash:", resData.transactionHash)

        let versionNumber = await pmc.connect(owner)
            .functions.getLatestVersionNumber()
        console.log("latest version number",  versionNumber[0].toString());

        return {
            "versionNumber" : versionNumber[0].toString()
        }
    })