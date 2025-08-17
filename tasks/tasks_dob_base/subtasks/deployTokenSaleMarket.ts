import { subtask } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "../../utils/contract-utils";
import * as path from 'path';
import { getSigner } from "../../utils/simulation-utils";
import { retryTransaction } from "../../utils/transaction";

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

        console.log("deploy tokenSaleMarketLogic")
        let tokenSaleMarketLogic = await deployerContract(
            hre, inData["contracts"]["tokenSaleMarket"], {}, false, {},
            [
                outData["storage"]["address"],
            ],
            creator);
        console.log("tokenSaleMarketLogic.address", tokenSaleMarketLogic.address)
        console.log("deploy tokenSaleMarketProxy")
        let proxy = await deployerContract(
            hre, inData["contracts"]["proxy"], {}, false, {},
            [
                outData["storage"]["address"],
                "TSMProxy",
            ],
            creator
        )
        console.log("proxy.addres", proxy.address)
        const storage = await contractAt(
            hre, outData["storage"]["contract"], 
            outData["storage"]["address"]);

        console.log("->grant role to logic")
        const grantUserRoleResult = await retryTransaction(
            () => storage.connect(creator).grantUserRole(tokenSaleMarketLogic.address),
            "Grant user role to tokenSaleMarketLogic"
        );

        console.log("->grant role to proxy")
        const grantUserRoleResultProxy = await retryTransaction(
            () => storage.connect(creator).grantUserRole(proxy.address),
            "Grant user role to proxy"
        );

        console.log("->atomic initialize proxy + logic via initLogicAndCall")
        const initData = tokenSaleMarketLogic.interface.encodeFunctionData(
            "initialize",
            [
                inData["addressIds"]["tokenSaleMarketOwner"],
                inData["commission"]["tokenSaleMarket"]
            ]
        );
        await retryTransaction(
            () => proxy.connect(creator).initLogicAndCall(tokenSaleMarketLogic.address, initData),
            "Initialize proxy + logic via initLogicAndCall"
        )

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