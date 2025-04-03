import { subtask } from "hardhat/config";
import fs from 'fs';
import { contractAt, deployerContract } from "../../utils/contract-utils";
import { findEvent } from "../../utils/transaction";
import * as path from 'path';
import { checkCreatorAddress } from "../../utils/deploy-utils";

subtask("deployTreasuryPool", "Deploy a new Treasury Pool")
    .addPositionalParam("outputConfigFile", "the path to the config file where all the address will be stored")
    .addPositionalParam("inputConfigFile", "Path to input config to use")
    .setAction(async (taskArgs, hre) =>{
        console.log("Deploy treasury...")
        const accounts = await hre.ethers.getSigners();
        console.log("->ACCOUNTS LENGTH:", accounts.length);
        let inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.inputConfigFile), 'utf8'));
        let outData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.outputConfigFile), 'utf8'));
        if (!checkCreatorAddress(accounts,inData)){
            throw Error("creator address does not match")
        }
        const poolMaster = await contractAt(
            hre, outData["poolMaster"]["deployer"]["contract"], 
            outData["poolMaster"]["deployer"]["address"]);
        console.log("estimate gas")
        let estimated = await poolMaster.connect(accounts[inData["addressIds"]["creator"]])
            .estimateGas.createPoolMasterTreasuryPool(
                [inData["addressIds"]["treasuryOwner"]],
                [100],
                '{"na":"Dob Main Treasury","ma":0}'
            )
        console.log("estimated gas:", estimated.toString())
        console.log("deploy")
        let txData = await poolMaster.connect(accounts[inData["addressIds"]["creator"]])
            .functions.createPoolMasterTreasuryPool(
                [inData["addressIds"]["treasuryOwner"]],
                [100],
                '{"na":"Dob Main Treasury","ma":0}',
                {
                    gasLimit: estimated.mul(2).toString()
                }
            )

        let resData = await txData.wait();
        console.log("deploy complete")
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