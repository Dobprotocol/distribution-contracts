import { subtask, task } from "hardhat/config";
import fs from 'fs';
import { deployerContract } from "../utils/contract";
import { getSigner } from "../utils/account";
import * as path from 'path';

task("deployToken", "task to deploy the ERC20 Dob Token ")
    .addPositionalParam("deployerAddress", "The address of the deployer of the token. Must match the private key from .env file")
    .addOptionalParam("tokenName", "the name of the token", "DobToken")
    .addOptionalParam("tokenSymbol", "the symbol of the token", "DOB")
    .addOptionalParam("mintSupply", "the supply to mint for this token, in ether", "100")
    .addOptionalParam("ownerSupply", "the address that will own the minted supply. If not specified, the deployer address will be the owner", "")
    .addOptionalParam("outputFile", "the output file. If not set, a default name with a timestamp will be used", "")
    .setAction(async (taskArgs, hre) => {
        const now = new Date();
        let outFilename = taskArgs.outputFile === "" ? "output_" + now.toISOString() + "_locked_stacking.json" : taskArgs.outputFile;
        let outputConfigFile = path.join(
            __dirname, "deploys",
            outFilename);

        const accounts = await hre.ethers.getSigners();
        const signer = getSigner(taskArgs.deployerAddress, accounts)
        const mintSupply = hre.ethers.utils.parseEther(taskArgs.mintSupply)
        const ownerSupply = hre.ethers.utils.isAddress(taskArgs.ownerSupply) ? taskArgs.ownerSupply : taskArgs.deployerAddress


        let dobToken = await deployerContract(
            hre, "DobToken", {}, false, {},
            [
                taskArgs.tokenName,
                taskArgs.tokenSymbol
            ], signer);
        console.log("token address is:", dobToken.address);
        let res = await dobToken.connect(signer)
            .functions.mint_supply(
                ownerSupply, 
                mintSupply
            )
        let data = await res.wait()
        console.log("tokens minted, tx", data)
    })