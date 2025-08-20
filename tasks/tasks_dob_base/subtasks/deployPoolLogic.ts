import { subtask } from "hardhat/config";
import fs from 'fs';
import { contractAt, deployerContract } from "../../utils/contract-utils";
import * as path from 'path';
import { getSigner } from "../../utils/simulation-utils";

subtask("deployPoolLogic", "Deploy a new logic for participation pools")
    .addPositionalParam("storageAddress", "the address of the storage contract")
    .addPositionalParam("deployerAddress", "the address of the deployer. Must match the private key from .env file")
    .addOptionalParam("contract", "the contract name of the logic", "ParticipationPool")
    .setAction(async (taskArgs, hre) =>{
        console.log("Deploy Pool logic...")
        const accounts = await hre.ethers.getSigners();
        const deployer = await getSigner(taskArgs.deployerAddress, accounts);

        let logic = await deployerContract(
            hre,taskArgs.contract, {}, false, {}, 
            [
                taskArgs.storageAddress
            ],
            deployer);
        console.log("->logic:", logic.address)
        return {"logic": logic.address, "contract": taskArgs.contract}
    })