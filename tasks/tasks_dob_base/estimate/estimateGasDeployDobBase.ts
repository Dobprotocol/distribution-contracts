import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import { estimateContractGas} from "../../utils/contract-utils";
import { BigNumber } from "ethers";
import { getSigner } from "../../utils/simulation-utils";


task("estimateGasDeployDobBase", "A task to estimate the deploy cost of base contracts for Dob enviroment")
    .addOptionalPositionalParam("configFile", "Path to the config file to use for the deploy")
    .addOptionalPositionalParam("creatorAddress", "The address that will deploy the contracts. Must match the private key from .env file")
    .setAction(async (taskArgs, hre) =>{
        // check files exsits
        if (!fs.existsSync(taskArgs.configFile)){
            throw new Error("config file does not exist")
        }
        let inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.configFile), 'utf8'));
        const accounts = await hre.ethers.getSigners();
        const creator = getSigner(taskArgs.creatorAddress, accounts)
        const avg_gas_price = await hre.ethers.provider.getGasPrice()
        console.log("avg gasPrice -> \t", hre.ethers.utils.formatEther(avg_gas_price.toString()))
        const limit_gas_price = avg_gas_price.mul(BigNumber.from(2))
        console.log("limit gasPrice -> \t", hre.ethers.utils.formatEther(limit_gas_price.toString()))
        console.log("::: estimate (gasUsed * gasPrice) to deploy each contract :::")
        let storage: BigNumber = await estimateContractGas(
            hre, inData["contracts"]["storage"], {}, false, {}, 
            [], 
            creator);
        storage = storage.mul(limit_gas_price)
        
        console.log("storage -> \t\t\t", hre.ethers.utils.formatEther(storage.toString()))

        let poolMasterConfigLogic = await estimateContractGas(
            hre, inData["contracts"]["poolMasterConfig"], {}, false, {}, 
            [
                hre.ethers.constants.AddressZero
            ],
            creator);
        let poolMasterConfigProxy = await estimateContractGas(
            hre, inData["contracts"]["proxy"], {}, false, {}, 
            [
                hre.ethers.constants.AddressZero, "Pool.master.config.proxy"
            ],
            creator);
        poolMasterConfigLogic = poolMasterConfigLogic.mul(limit_gas_price)
        poolMasterConfigProxy = poolMasterConfigProxy.mul(limit_gas_price)
        console.log("pool master config logic -> \t", hre.ethers.utils.formatEther(poolMasterConfigLogic.toString()))
        console.log("pool master config proxy -> \t", hre.ethers.utils.formatEther(poolMasterConfigProxy.toString()))

        let poolMasterDeployerLogic = await estimateContractGas(
            hre, inData["contracts"]["poolMasterDeployer"], {}, false, {}, 
            [
                hre.ethers.constants.AddressZero
            ],
            creator);
        let poolMasterDeployerProxy = await estimateContractGas(
            hre, inData["contracts"]["proxy"], {}, false, {}, 
            [
                hre.ethers.constants.AddressZero, "Pool.master.deployer.proxy"
            ],
            creator);
        poolMasterDeployerLogic = poolMasterDeployerLogic.mul(limit_gas_price)
        poolMasterDeployerProxy = poolMasterDeployerProxy.mul(limit_gas_price)
        console.log("pool master deployer logic -> \t", hre.ethers.utils.formatEther(poolMasterConfigLogic.toString()))
        console.log("pool master deployer proxy -> \t", hre.ethers.utils.formatEther(poolMasterConfigProxy.toString()))

        let logic = await estimateContractGas(
            hre,inData["contracts"]["participationPool"], {}, false, {}, 
            [
                hre.ethers.constants.AddressZero
            ],
            creator);

        logic = logic.mul(limit_gas_price)
        console.log("participation pool logic -> \t", hre.ethers.utils.formatEther(logic.toString()))


        console.log("treasury pool  -> \t\t cannot estimate")

        let tokenSaleMarketLogic = await estimateContractGas(
            hre, inData["contracts"]["tokenSaleMarket"], {}, false, {},
            [
                hre.ethers.constants.AddressZero,
                // {gasPrice: "7000000000"}
            ],
            creator);
        let proxy = await estimateContractGas(
            hre, inData["contracts"]["proxy"], {}, false, {},
            [
                hre.ethers.constants.AddressZero,
                "TSMProxy",
                // {gasPrice: "7000000000"}
            ],
            creator
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
    })