import { subtask } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "../../utils/contract-utils";
import * as path from 'path';
import { getSigner } from "../../utils/simulation-utils";

subtask("deployTokenSaleMarket", "Deploy a new tokenSaleMarket")
    .addPositionalParam("outputConfigFile", "the path to the config file where all the address will be stored")
    .addPositionalParam("inputConfigFile", "Path to input config to use")
    .addPositionalParam("creatorAddress", "The address that will deploy the contracts. Must match the private key from .env file")
    .setAction(async (taskArgs, hre) =>{
        console.log("deploy token sale market...")
        const accounts = await hre.ethers.getSigners();
        const creator = getSigner(taskArgs.creatorAddress, accounts);

        let inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.inputConfigFile), 'utf8'));
        let outData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.outputConfigFile), 'utf8'));

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
                // {gasPrice: gasPrice}
            ],
            creator);
        console.log("tokenSaleMarketLogic.address", tokenSaleMarketLogic.address)
        console.log("deploy tokenSaleMarketProxy")
        let proxy = await deployerContract(
            hre, inData["contracts"]["proxy"], {}, false, {},
            [
                outData["storage"]["address"],
                "TSMProxy",
                // {gasPrice: gasPrice}
            ],
            creator
        )
        console.log("proxy.addres", proxy.address)
        console.log("done deploys")
        let txData;
        let resData;
        let estimated;
        const storage = await contractAt(
            hre, outData["storage"]["contract"], 
            outData["storage"]["address"]);
        console.log("->grant role to logic")
        estimated = await storage.connect(creator)
            .estimateGas.grantUserRole(tokenSaleMarketLogic.address);
        txData = await storage.connect(creator)
            .functions.grantUserRole(
                tokenSaleMarketLogic.address, 
                // {
                //     gasLimit: estimated.mul(gasLimitMultiplier).toString(),
                //     gasPrice: gasPrice
                // }
            );
        resData = await txData.wait();
        console.log("->grant role to proxy")
        estimated = await storage.connect(creator)
            .estimateGas.grantUserRole(proxy.address);
        txData = await storage.connect(creator)
            .functions.grantUserRole(
                proxy.address, 
                // {
                //     gasLimit: estimated.mul(gasLimitMultiplier).toString(),
                //     gasPrice: gasPrice
                // }
            );
        resData = await txData.wait();
        console.log("->atomic initialize proxy + logic via initLogicAndCall")
        const initData = tokenSaleMarketLogic.interface.encodeFunctionData(
            "initialize",
            [
                inData["addressIds"]["tokenSaleMarketOwner"],
                inData["commission"]["tokenSaleMarket"]
            ]
        );
        estimated = await proxy.connect(creator)
            .estimateGas.initLogicAndCall(tokenSaleMarketLogic.address, initData);
        txData = await proxy.connect(creator)
            .functions.initLogicAndCall(
                tokenSaleMarketLogic.address,
                initData,
                // {
                //     gasLimit: estimated.mul(gasLimitMultiplier).toString(),
                //     gasPrice: gasPrice
                // }
            );
        resData = await txData.wait();
        const tsmProxy = tokenSaleMarketLogic.attach(proxy.address);

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