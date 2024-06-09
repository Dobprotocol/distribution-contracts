import { subtask } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "./utils/contract-utils";
import * as path from 'path';
import { checkCreatorAddress } from "./utils/deploy-utils";

subtask("deployTokenSaleMarket", "Deploy a new tokenSaleMarket")
    .addPositionalParam("outputConfigFile", "the path to the config file where all the address will be stored")
    .addPositionalParam("inputConfigFile", "Path to input config to use")
    .setAction(async (taskArgs, hre) =>{
        console.log("deploy token sale market...")
        const accounts = await hre.ethers.getSigners();
        let inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.inputConfigFile), 'utf8'));
        let outData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.outputConfigFile), 'utf8'));
        if (!checkCreatorAddress(accounts,inData)){
            throw Error("creator address does not match")
        }
        let gasLimitMultiplier = 2
        if ("gasLimitMultiplier" in inData){
            gasLimitMultiplier = inData["gasLimitMultiplier"]
        }
        let gasPrice = inData["regression"]["gasPrice"]
        console.log("deploy tokenSaleMarketLogic")
        let tokenSaleMarketLogic = await deployerContract(
            hre, inData["contracts"]["tokenSaleMarket"], {}, false, {},
            [
                outData["storage"]["address"],
                {gasPrice: gasPrice}
            ],
            accounts[inData["addressIds"]["creator"]]);
        console.log("deploy tokenSaleMarketProxy")
        let proxy = await deployerContract(
            hre, inData["contracts"]["proxy"], {}, false, {},
            [
                outData["storage"]["address"],
                "TSMProxy",
                {gasPrice: gasPrice}
            ],
            accounts[inData["addressIds"]["creator"]]
        )
        console.log("done deploys")
        let txData;
        let resData;
        let estimated;
        const storage = await contractAt(
            hre, outData["storage"]["contract"], 
            outData["storage"]["address"]);
        console.log("->grant role to logic")
        estimated = await storage.connect(accounts[inData["addressIds"]["creator"]])
            .estimateGas.grantUserRole(tokenSaleMarketLogic.address);
        txData = await storage.connect(accounts[inData["addressIds"]["creator"]])
            .functions.grantUserRole(
                tokenSaleMarketLogic.address, 
                {
                    gasLimit: estimated.mul(gasLimitMultiplier).toString(),
                    gasPrice: gasPrice
                }
            );
        resData = await txData.wait();
        console.log("->grant role to proxy")
        estimated = await storage.connect(accounts[inData["addressIds"]["creator"]])
            .estimateGas.grantUserRole(proxy.address);
        txData = await storage.connect(accounts[inData["addressIds"]["creator"]])
            .functions.grantUserRole(
                proxy.address, 
                {
                    gasLimit: estimated.mul(gasLimitMultiplier).toString(),
                    gasPrice: gasPrice
                }
            );
        resData = await txData.wait();
        console.log("->initialize proxy")
        estimated = await proxy.connect(accounts[inData["addressIds"]["creator"]])
            .estimateGas.initLogic(tokenSaleMarketLogic.address);
        txData = await proxy.connect(accounts[inData["addressIds"]["creator"]])
            .functions.initLogic(
                tokenSaleMarketLogic.address, 
                {
                    gasLimit: estimated.mul(gasLimitMultiplier).toString(),
                    gasPrice: gasPrice
                }
            );
        resData = await txData.wait();
        console.log("->attach abi")
        let tsmProxy = tokenSaleMarketLogic.attach(proxy.address);
        console.log("->initialize logic through proxy")
        estimated = await tsmProxy.connect(accounts[inData["addressIds"]["creator"]])
            .estimateGas.initialize(
                inData["addressIds"]["tokenSaleMarketOwner"],
                inData["commission"]["tokenSaleMarket"])
        txData = await tsmProxy.connect(accounts[inData["addressIds"]["creator"]])
            .functions.initialize(
                inData["addressIds"]["tokenSaleMarketOwner"],
                inData["commission"]["tokenSaleMarket"]),
                {
                    gasLimit: estimated.mul(gasLimitMultiplier).toString(),
                    gasPrice: gasPrice
                }
        resData = await txData.wait();

        outData["tokenSaleMarket"] = {
            "address": proxy.address,
            "contract": inData["contracts"]["proxy"],
            "owner": inData["addressIds"]["tokenSaleMarketOwner"],
            "logic": {
                "address": tokenSaleMarketLogic.address,
                "contract": inData["contracts"]["tokenSaleMarket"]
            },
            "commission": inData["commission"]["tokenSaleMarket"]
        }
        
        fs.writeFileSync(taskArgs.outputConfigFile, JSON.stringify(outData, null, 2));
    })