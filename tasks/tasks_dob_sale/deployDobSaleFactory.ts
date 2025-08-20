import { task } from "hardhat/config";
import fs from 'fs';
import { deployerContract } from "../utils/contract";
import { getSigner } from "../utils/account";
import * as path from 'path';
import { retryTransaction } from "../utils/transaction";

task("deployDobSaleFactory", "Deploy DobSaleFactory contract with linked DobSale implementation.")
    .addPositionalParam(
        "deployerAddress",
        "The address of the deployer wallet. This will be compared to the private key stored in .env file and checked"
    )
    .addOptionalParam("owner", "Address to transfer ownership to after deployment (optional)", "")
    .addOptionalParam("commissionPercent", "Commission percent for the factory, amplified by 1000 (e.g 5 -> 5000) ", "1500")
    .addOptionalParam("commissionAddress", "Commission address for the factory", "0x0000000000000000000000000000000000000000")
    .addOptionalParam("outputFile", "Path to the output config file. By default uses tasks/outputs/deployDobSaleFactory/output_<datetime>.json", "")
    .setAction(async (taskArgs, hre) => {
        const now = new Date();
        const defaultOutputFolder = path.join(path.dirname(__dirname), "outputs", "deployDobSaleFactory")
        let outputFile;
        if (taskArgs.outputFile === "") {
            outputFile = path.join(defaultOutputFolder, `output_${now.toISOString()}.json`);
        } else {
            outputFile = taskArgs.outputFile;
        }
        if (!fs.existsSync(path.dirname(outputFile))) {
            console.log("creating", path.dirname(outputFile))
            fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        }

        const accounts = await hre.ethers.getSigners();
        const signer = getSigner(taskArgs.deployerAddress, accounts);
        console.log("config used:");
        console.log("-> commissionPercent:", taskArgs.commissionPercent);
        console.log("-> commissionAddress:", taskArgs.commissionAddress);
        // deploy DobSaleFactory contract
        console.log("deploy DobSaleFactory contract...");
        let dobSaleFactory = await deployerContract(
            hre, "DobSaleFactory", {}, false, {}, [taskArgs.commissionAddress, taskArgs.commissionPercent], signer
        );
        // Transfer ownership if owner argument is provided and different from deployer
        if (taskArgs.owner && taskArgs.owner !== "" && taskArgs.owner.toLowerCase() !== signer.address.toLowerCase()) {
            await retryTransaction(
                () => dobSaleFactory.connect(signer).transferOwnership(taskArgs.owner),
                `Transferring ownership to ${taskArgs.owner}`
            );
        }
        console.log("deployed contract address is:", dobSaleFactory.address);
        let data = {
            "contract": {
                "address": dobSaleFactory.address,
                "owner": taskArgs.owner && taskArgs.owner !== "" ? taskArgs.owner : signer.address,
                "name": "DobSaleFactory"
            },
            "config": {
                "commissionPercent": taskArgs.commissionPercent,
                "commissionAddress": taskArgs.commissionAddress
            }
        };
        console.log("writing data", data);
        console.log("writing to file", outputFile)
        fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
    });
