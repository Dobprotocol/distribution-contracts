import { subtask, task } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "../utils/contract";
import { getSigner } from "../utils/account";
import * as path from 'path';

task("deployDobSale", "task to deploy the smart contract DobSale.")
    .addPositionalParam(
        "deployerAddress", 
        "The address of the deployer wallet. This will be compared to the private key stored in .env file and checked")
    .addPositionalParam("saleToken", "The address of the ERC20 token to sale")
    .addPositionalParam("price", "The price per token to use, in ether")
    .addOptionalParam("outputFile", "Path to the output config file. By default uses tasks/outputs/deployDobSale/output_<datetime>.json", "")
    .setAction(async (taskArgs, hre) => {
        const now = new Date();
        const defaultOutputFolder = path.join(path.dirname(__dirname), "outputs", "deployDobSale")
        // check output file
        let outputFile;
        if (taskArgs.outputFile === ""){
            outputFile=path.join(defaultOutputFolder, `output_${now.toISOString()}.json`);
        } else {
            outputFile = taskArgs.outputFile;
        }
        // check if output folder exists, if not, create
        if (!fs.existsSync(path.dirname(outputFile))){
            console.log("creating", path.dirname(outputFile))
            fs.mkdirSync(path.dirname(outputFile), {recursive: true});
        }
        
        const accounts = await hre.ethers.getSigners();
        const signer = getSigner(taskArgs.deployerAddress, accounts);
        const price = hre.ethers.utils.parseEther(taskArgs.price).toString()
        console.log("config used:")
        console.log("-> token:", taskArgs.saleToken)
        console.log("-> price (eth):", taskArgs.price, "| wei:", price)
        // deploy contract
        console.log("deploy DobSale contract...")
        let dobSale = await deployerContract(
            hre, "DobSale", {}, false, {},
            [
                taskArgs.saleToken,
                price
            ], signer);
        console.log("deployed contract address is:", dobSale.address)
        // write output file
        let data = {
            "contract": {
                "address": dobSale.address,
                "owner": signer.address,
                "name": "DobSale"
            },
            "config": {
                "saleToken": taskArgs.saleToken,
                "price": price
            }
        }
        console.log("writing data", data)
        console.log("writing to file", outputFile)
        fs.writeFileSync(outputFile, JSON.stringify(data, null, 2))
        
    })