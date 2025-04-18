import { subtask } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "../../utils/contract-utils";
import * as path from 'path';
import { getSigner } from "../../utils/simulation-utils";

subtask("deployPoolMaster", "Deploy a new poolMaster")
    .addPositionalParam("outputConfigFile", "the path to the config file where all the address will be stored")
    .addPositionalParam("inputConfigFile", "Path to input config to use")
    .addPositionalParam("creatorAddress", "The address that will deploy the contracts. Must match the private key from .env file")
    .setAction(async (taskArgs, hre) =>{
        console.log("Deploy PoolMaster...")
        const accounts = await hre.ethers.getSigners();
        const creator = getSigner(taskArgs.creatorAddress, accounts);

        let inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.inputConfigFile), 'utf8'));
        let outData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.outputConfigFile), 'utf8'));
        

        const storage = await contractAt(
            hre, outData["storage"]["contract"], 
            outData["storage"]["address"]);

        let poolMasterConfigLogic = await deployerContract(
            hre, inData["contracts"]["poolMasterConfig"], {}, false, {}, 
            [
                outData["storage"]["address"]
            ],
            creator);
        let poolMasterConfigProxy = await deployerContract(
            hre, inData["contracts"]["proxy"], {}, false, {}, 
            [
                outData["storage"]["address"], "Pool.master.config.proxy"
            ],
            creator);
        
        let txData;
        let resData;
        txData = await storage.connect(creator)
            .functions.grantUserRole(poolMasterConfigProxy.address);
        resData = await txData.wait()
        txData = await storage.connect(creator)
            .functions.grantAdminRole(poolMasterConfigProxy.address);
        resData = await txData.wait()
        console.log("-> poolMasterConfigLogic address:", poolMasterConfigLogic.address)
        console.log("-> poolMasterConfigProxy address:", poolMasterConfigProxy.address);
        txData = await poolMasterConfigProxy.connect(creator)
            .functions.initLogic(poolMasterConfigLogic.address);
        resData = await txData.wait()
        let poolMasterConfig = poolMasterConfigLogic.attach(poolMasterConfigProxy.address)
        let poolMasterDeployerLogic = await deployerContract(
            hre, inData["contracts"]["poolMasterDeployer"], {}, false, {}, 
            [
                outData["storage"]["address"]
            ],
            creator);
        let poolMasterDeployerProxy = await deployerContract(
            hre, inData["contracts"]["proxy"], {}, false, {}, 
            [
                outData["storage"]["address"], "Pool.master.deployer.proxy"
            ],
            creator);
        txData = await storage.connect(creator)
            .functions.grantUserRole(poolMasterDeployerProxy.address);
        resData = await txData.wait()
        txData = await storage.connect(creator)
            .functions.grantAdminRole(poolMasterDeployerProxy.address);
        resData = await txData.wait()
        console.log("-> poolMasterDeployerLogic address:", poolMasterDeployerLogic.address)
        console.log("-> poolMasterDeployerProxy address:", poolMasterDeployerProxy.address);
        let estimated;

        estimated = await poolMasterDeployerProxy.connect(creator)
            .estimateGas.initLogic(poolMasterDeployerLogic.address);
        console.log("---> estimatedGas for deploer initLogic:", estimated.toString())
        txData = await poolMasterDeployerProxy.connect(creator)
            .functions.initLogic(poolMasterDeployerLogic.address, {gasLimit: estimated.toString()});
        resData = await txData.wait()
        let poolMasterDeployer = poolMasterDeployerLogic.attach(poolMasterDeployerProxy.address)
        estimated = await poolMasterConfig.connect(creator)
            .estimateGas.initialize(
                inData["regression"]["coef"], 
                inData["regression"]["intercept"],
                inData["regression"]["gasPrice"],
                inData["addressIds"]["operational"],
                inData["commission"]["poolMaster"],
            )
        console.log("---> estimateGas for pmconfig initialize:", estimated.toString())
        txData = await poolMasterConfig.connect(creator)
            .functions.initialize(
                inData["regression"]["coef"], 
                inData["regression"]["intercept"],
                inData["regression"]["gasPrice"],
                inData["addressIds"]["operational"],
                inData["commission"]["poolMaster"],
                {
                    gasLimit: estimated.toString()
                }
            )
        resData = await txData.wait()
        estimated = await poolMasterDeployer.connect(creator)
            .estimateGas.initialize(
                poolMasterConfigProxy.address
            )
        console.log("--->estimated gas for deployer initialize:", estimated.toString())
        txData = await poolMasterDeployer.connect(creator)
            .functions.initialize(
                poolMasterConfigProxy.address,
                {gasLimit: estimated.mul(2).toString()}
            )
        resData = await txData.wait()
        console.log("->operationalId:", inData["addressIds"]["operational"])
        
        outData["poolMaster"] = {
            "config": {
                "address": poolMasterConfig.address,
                "contract": inData["contracts"]["poolMasterConfig"],
                "operational": inData["addressIds"]["operational"],
                "regression": {
                    "coef": inData["regression"]["coef"],
                    "intercept": inData["regression"]["intercept"],
                    "gasPrice": inData["regression"]["gasPrice"]
                },
                "commission": inData["commission"]["poolMaster"]
            },
            "deployer": {
                "address": poolMasterDeployer.address,
                "contract": inData["contracts"]["poolMasterDeployer"]
            },
            "owner": inData["addressIds"]["storageOwner"],
        }

        fs.writeFileSync(taskArgs.outputConfigFile, JSON.stringify(outData, null, 2))
    })