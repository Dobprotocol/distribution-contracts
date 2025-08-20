import { subtask } from "hardhat/config";
import fs from 'fs';
import { contractAt, deployerContract } from "../../utils/contract-utils";
import { findEvent } from "../../utils/transaction";
import * as path from 'path';
import { getSigner } from "../../utils/simulation-utils";
import { retryTransaction } from "../../utils/transaction";

subtask("deployTreasuryPool", "Deploy a new Treasury Pool")
    .addPositionalParam("outputConfigFile", "the path to the config file where all the address will be stored")
    .addPositionalParam("inputConfigFile", "Path to input config to use")
    .addPositionalParam("creatorAddress", "The address that will deploy the contracts. Must match the private key from .env file")
    .setAction(async (taskArgs, hre) =>{
        console.log("Deploy treasury...")
        const accounts = await hre.ethers.getSigners();
        const creator = getSigner(taskArgs.creatorAddress, accounts);

        let inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.inputConfigFile), 'utf8'));
        let outData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.outputConfigFile), 'utf8'));

        const poolMaster = await contractAt(
            hre, outData["poolMaster"]["deployer"]["contract"], 
            outData["poolMaster"]["deployer"]["address"]);
            
        const {txData, resData} = await retryTransaction(
            () => poolMaster.connect(creator)
            .functions.createPoolMasterTreasuryPool(
                [inData["addressIds"]["treasuryOwner"]],
                [100],
                '{"na":"Dob Main Treasury","ma":0}'
            ),
            "Create Pool Master Treasury Pool"
        )
        let event = findEvent(resData, "CreatePool")

        outData["treasury"] = {
            "address": event.args.contractAddress,
            "ParticipationToken": {
                "address": event.args.tokenAddress,
                "name": "DobToken"
            },
            "owner": inData["addressIds"]["treasuryOwner"],
            "logicVersion": event.args.logicVersion.toString()
        }
        fs.writeFileSync(taskArgs.outputConfigFile, JSON.stringify(outData, null, 2))
    })