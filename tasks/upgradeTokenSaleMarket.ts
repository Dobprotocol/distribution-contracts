import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import { contractAt, upgradeContract, deployerContract } from "./subtasks/utils/contract-utils";
import "./subtasks/upgradeContract";
import { getSigner } from "./subtasks/utils/simulation-utils";

task("upgradeTokenSaleMarket", "Upgrade a token sale market logic to a new implementation")
    .addOptionalParam("outputConfigFile", "tag used to identify output files", "dobBase.json")
    .addOptionalParam("tsmLogic", "the address of the new logic version", "none")
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners();
        let outputConfigFile = path.join(
            __dirname, "deploys", 
            taskArgs.outputConfigFile);

        let outData = JSON.parse(fs.readFileSync(
            path.join(outputConfigFile), 'utf8'));
        
        let newLogic;
        if (taskArgs.tsmLogic != "none"){
            console.log("->using logic from input with address: ", taskArgs.tsmLogic);
            newLogic = taskArgs.tsmLogic
        } else {
            // deploy a new token sale market
            console.log("deploying new logic...")
            let tokenSaleMarketLogic = await deployerContract(
                hre, outData["tokenSaleMarket"]["logic"]["contract"], {}, false, {},
                [
                    outData["storage"]["address"]
                ],
                getSigner(outData["tokenSaleMarket"]["owner"], accounts));
            newLogic = tokenSaleMarketLogic.address;
            console.log("->new token sale market logic address is:", tokenSaleMarketLogic.address);
        }
        // upgrade contract
        let args = {
            "logicAddress": newLogic,
            "proxyAddress": outData["tokenSaleMarket"]["address"],
            "owner": outData["tokenSaleMarket"]["owner"]
        }
        console.log("call subtask upgradeContract...")
        await hre.run("upgradeContract", args)

        console.log("update output file...")
        outData["tokenSaleMarket"]["logic"]["address"] = newLogic;
        fs.writeFileSync(outputConfigFile, JSON.stringify(outData, null, 2))
    })