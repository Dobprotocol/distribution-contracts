import { subtask, task } from "hardhat/config";
import fs from 'fs';
import { deployerContract } from "..//utils/contract-utils";
import * as path from 'path';
import { getSigner } from "../utils/simulation-utils";

task("deployERC20", "task to deploy a ERC20 token and mint initial supply")
    .addPositionalParam("name", "the name for the ERC20")
    .addPositionalParam("symbol", "the symbol for the ERC20")
    .addOptionalParam("decimals", "the decimals for the ERC20", "18")
    .addOptionalParam(
        "initialSupply",
        "the initial supply for the ERC20, in ether units", "100000000")
    .addOptionalParam(
        "supplyOwner",
        "The supply owner for the minted supply. By default it will be the deployer address", "")
    .addOptionalParam(
        "deployerAddress",
        "The address that will deploy and mint the tokens. Must match the private key from .env file")
    .addOptionalParam(
        "outputFile", 
        "Path to the output file. By default uses ./outputs/deployERC20/output_<datetime>.json", ""
    )
    .setAction(async (taskArgs, hre) => {
        const now = new Date();
        const accounts = await hre.ethers.getSigners();
        const deployer = getSigner(taskArgs.deployerAddress, accounts)
        const supplyOwner = taskArgs.supplyOwner === "" ? deployer.address : taskArgs.supplyOwner
        const initialSupply = hre.ethers.utils.parseEther(taskArgs.initialSupply);

        let dobToken = await deployerContract(
            hre, "DobToken", {}, false, {},
            [
                taskArgs.name,
                taskArgs.symbol,
            ], deployer);
        console.log("dob token address is:", dobToken.address);
        console.log(`minting ${initialSupply.toString()} tokens to address ${supplyOwner}...`)
        let res = await dobToken.connect(deployer)
            .functions.mint_supply(
                supplyOwner,
                initialSupply.toString()
            )
        let data = await res.wait()
        console.log("tokens minted, tx", data)

        let outData = {
            "network": hre.network.name,
            "deployer": deployer.address,
            "token_name": taskArgs.name,
            "token_symbol": taskArgs.symbol,
            "token_address": dobToken.address,
            "token_decimals": taskArgs.decimals,
            "initial_supply": taskArgs.initialSupply,
            "supply_owner": supplyOwner,
            "tx_mint_hash": data.transactionHash
        }

        const defaultOutputFolder = path.join(path.dirname(__dirname), "outputs", "deployERC20")
        let outputFile;
        if (taskArgs.outputFile === ""){
            outputFile=path.join(defaultOutputFolder, `output_${now.toISOString()}.json`);
        } else {
            outputFile = taskArgs.outputFile;
        }
        // check if output folder exists, if not, create
        if (!fs.existsSync(path.dirname(outputFile))){
            fs.mkdirSync(path.dirname(outputFile), {recursive: true});
        }

        fs.writeFileSync(outputFile, JSON.stringify(outData, null, 2))
    })