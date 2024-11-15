import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import "./subtasks/deployLogic";
import "./subtasks/deployPoolMaster";
import "./subtasks/deployStorage";
import "./subtasks/deployTreasuryPool";
import "./subtasks/deployTokenSaleMarket";
import "./subtasks/transferOnwership";
import { checkCreatorAddress } from "./subtasks/utils/deploy-utils";
import { estimateContractGas} from "./subtasks/utils/contract-utils";
import { BigNumber } from "ethers";


task("estimateGasDeployDobBase", "A task to estimate the deploy cost of base contracts for Dob enviroment")
    .addOptionalParam("inputConfigFile", "Name of the input config to use", "dob_base.json")
    .setAction(async (taskArgs, hre) =>{
        const now = new Date();
        let inputConfigFile = path.join(
            __dirname, "configs", 
            taskArgs.inputConfigFile);
        let inData = JSON.parse(fs.readFileSync(
            path.join(inputConfigFile), 'utf8'));
        const accounts = await hre.ethers.getSigners();
        if (!checkCreatorAddress(accounts,inData)){
            console.log("trowing error")
            throw new Error("creator address does not match")
        }
        const avg_gas_price = BigNumber.from("70000000")
        console.log("avg gasPrice -> \t", hre.ethers.utils.formatEther(avg_gas_price.toString()))
        const limit_gas_price = avg_gas_price.mul(BigNumber.from(2))
        console.log("limit gasPrice -> \t", hre.ethers.utils.formatEther(limit_gas_price.toString()))
        console.log("::: estimate (gasUsed * gasPrice) to deploy each contract :::")
        let storage: BigNumber = await estimateContractGas(
            hre, inData["contracts"]["storage"], {}, false, {}, 
            [], 
            accounts[inData["addressIds"]["creator"]]);
        storage = storage.mul(limit_gas_price)
        
        console.log("storage -> \t\t\t", hre.ethers.utils.formatEther(storage.toString()))

        let poolMasterConfigLogic = await estimateContractGas(
            hre, inData["contracts"]["poolMasterConfig"], {}, false, {}, 
            [
                hre.ethers.constants.AddressZero
            ],
            accounts[inData["addressIds"]["creator"]]);
        let poolMasterConfigProxy = await estimateContractGas(
            hre, inData["contracts"]["proxy"], {}, false, {}, 
            [
                hre.ethers.constants.AddressZero, "Pool.master.config.proxy"
            ],
            accounts[inData["addressIds"]["creator"]]);
        poolMasterConfigLogic = poolMasterConfigLogic.mul(limit_gas_price)
        poolMasterConfigProxy = poolMasterConfigProxy.mul(limit_gas_price)
        console.log("pool master config logic -> \t", hre.ethers.utils.formatEther(poolMasterConfigLogic.toString()))
        console.log("pool master config proxy -> \t", hre.ethers.utils.formatEther(poolMasterConfigProxy.toString()))

        let poolMasterDeployerLogic = await estimateContractGas(
            hre, inData["contracts"]["poolMasterDeployer"], {}, false, {}, 
            [
                hre.ethers.constants.AddressZero
            ],
            accounts[inData["addressIds"]["creator"]]);
        let poolMasterDeployerProxy = await estimateContractGas(
            hre, inData["contracts"]["proxy"], {}, false, {}, 
            [
                hre.ethers.constants.AddressZero, "Pool.master.deployer.proxy"
            ],
            accounts[inData["addressIds"]["creator"]]);
        poolMasterDeployerLogic = poolMasterDeployerLogic.mul(limit_gas_price)
        poolMasterDeployerProxy = poolMasterDeployerProxy.mul(limit_gas_price)
        console.log("pool master deployer logic -> \t", hre.ethers.utils.formatEther(poolMasterConfigLogic.toString()))
        console.log("pool master deployer proxy -> \t", hre.ethers.utils.formatEther(poolMasterConfigProxy.toString()))

        let logic = await estimateContractGas(
            hre,inData["contracts"]["participationPool"], {}, false, {}, 
            [
                hre.ethers.constants.AddressZero
            ],
            accounts[inData["addressIds"]["creator"]]);

        logic = logic.mul(limit_gas_price)
        console.log("participation pool logic -> \t", hre.ethers.utils.formatEther(logic.toString()))


        console.log("treasury pool  -> \t\t cannot estimate")

        let tokenSaleMarketLogic = await estimateContractGas(
            hre, inData["contracts"]["tokenSaleMarket"], {}, false, {},
            [
                hre.ethers.constants.AddressZero,
                // {gasPrice: "7000000000"}
            ],
            accounts[inData["addressIds"]["creator"]]);
        let proxy = await estimateContractGas(
            hre, inData["contracts"]["proxy"], {}, false, {},
            [
                hre.ethers.constants.AddressZero,
                "TSMProxy",
                // {gasPrice: "7000000000"}
            ],
            accounts[inData["addressIds"]["creator"]]
        )
        tokenSaleMarketLogic = tokenSaleMarketLogic.mul(limit_gas_price)
        proxy = proxy.mul(limit_gas_price)
        console.log("token sale market logic -> \t", hre.ethers.utils.formatEther(tokenSaleMarketLogic.toString()))
        console.log("token sale market  proxy -> \t", hre.ethers.utils.formatEther(proxy.toString()))
        console.log("---------------------")
        let total = storage.add(poolMasterConfigLogic)
            .add(poolMasterConfigProxy).add(poolMasterDeployerLogic)
            .add(poolMasterDeployerProxy).add(logic).add(tokenSaleMarketLogic)
            .add(proxy)

        console.log("total -> \t\t\t", hre.ethers.utils.formatEther(total.toString()))

        // await hre.run("deployPoolMaster", argFiles)
        // await new Promise(f => setTimeout(f, 1000));
        // await hre.run("deployLogic", argFiles)
        // await new Promise(f => setTimeout(f, 1000));
        // await hre.run("deployTreasuryPool", argFiles)
        // await new Promise(f => setTimeout(f, 1000));
        // await hre.run("deployTokenSaleMarket", argFiles)
        // await new Promise(f => setTimeout(f, 1000));
        // await hre.run("transferOwnership", argFiles)
    })