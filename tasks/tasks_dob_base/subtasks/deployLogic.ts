import { subtask } from "hardhat/config";
import fs from 'fs';
import { contractAt, deployerContract } from "../../utils/contract-utils";
import * as path from 'path';
import { getSigner } from "../../utils/simulation-utils";

subtask("deployLogic", "Deploy a new logic for participation pools")
    .addPositionalParam("outputConfigFile", "the path to the config file where all the address will be stored")
    .addPositionalParam("inputConfigFile", "Path to input config to use")
    .addPositionalParam("creatorAddress", "The address that will deploy the contracts. Must match the private key from .env file")
    .setAction(async (taskArgs, hre) =>{
        console.log("Deploy logic...")
        const accounts = await hre.ethers.getSigners();
        const creator = getSigner(taskArgs.creatorAddress, accounts);

        let inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.inputConfigFile), 'utf8'));
        let outData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.outputConfigFile), 'utf8'));

        let logic = await deployerContract(
            hre,inData["contracts"]["participationPool"], {}, false, {}, 
            [
                outData["storage"]["address"]
            ],
            creator);
        console.log("->logic:", logic.address)
        const poolMaster = await contractAt(
            hre, outData["poolMaster"]["config"]["contract"], 
            outData["poolMaster"]["config"]["address"]);

        let txData = await poolMaster.connect(creator)
            .functions.addLogic(logic.address, inData["contracts"]["participationPool"])
        let resData = await txData.wait()
        
        let data = await poolMaster.connect(creator)
            .functions.getLatestVersion()

        console.log("latest version data", data);
        let _version = await poolMaster.connect(creator)
            .functions.getLatestVersionNumber()

        if (!("poolLogic" in outData)){
            outData["poolLogic"] = []
        }
        outData["poolLogic"].push({
            "contract": taskArgs.logicContract,
            "address": logic.address,
            "versionNumber": _version[0].toString()
        })

        fs.writeFileSync(taskArgs.outputConfigFile, JSON.stringify(outData, null, 2))
    })