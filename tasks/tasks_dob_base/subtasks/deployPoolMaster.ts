import { subtask } from "hardhat/config";
import fs from 'fs';
import { deployerContract, contractAt } from "../../utils/contract-utils";
import * as path from 'path';
import { getSigner } from "../../utils/simulation-utils";

// Helper function to retry blockchain transactions
async function retryTransaction(
    txFunction: () => Promise<any>,
    description: string,
    retries: number = 3,
    delayMs: number = 3000,
    backoffFactor: number = 2
): Promise<any> {
    const wait = (ms: number) => new Promise(res => setTimeout(res, ms));
    
    let lastError: any;
    let attempt = 0;
    let currentDelay = delayMs;
    
    while (attempt <= retries) {
        try {
            console.log(`[${description}] Attempting transaction (attempt ${attempt + 1}/${retries + 1})`);
            const txData = await txFunction();
            const resData = await txData.wait();
            if (attempt > 0) {
                console.log(`[${description}] Transaction succeeded on attempt ${attempt + 1}`);
            }
            return { txData, resData };
        } catch (err) {
            lastError = err;
            console.warn(`[${description}] Attempt ${attempt + 1} failed:`, err?.message || err);
            attempt++;
            if (attempt > retries) break;
            if (currentDelay > 0) {
                console.log(`[${description}] Retrying in ${currentDelay} ms`);
                await wait(currentDelay);
                currentDelay = Math.floor(currentDelay * backoffFactor);
            }
        }
    }
    console.error(`[${description}] All ${retries + 1} attempts failed`);
    throw lastError;
}

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
        console.log("-> Granting roles for poolMasterConfigProxy");
        const grantUserRoleResult = await retryTransaction(
            () => storage.connect(creator).functions.grantUserRole(poolMasterConfigProxy.address),
            "Grant user role for poolMasterConfigProxy"
        );
        console.log("-> Granted user role for poolMasterConfigProxy");
        console.log("-> Granting admin role for poolMasterConfigProxy");
        const grantAdminRoleResult = await retryTransaction(
            () => storage.connect(creator).functions.grantAdminRole(poolMasterConfigProxy.address),
            "Grant admin role for poolMasterConfigProxy"
        );
        console.log("-> poolMasterConfigLogic address:", poolMasterConfigLogic.address)
        console.log("-> poolMasterConfigProxy address:", poolMasterConfigProxy.address);
        const configInitData = poolMasterConfigLogic.interface.encodeFunctionData(
            "initialize",
            [
                inData["regression"]["coef"], 
                inData["regression"]["intercept"],
                inData["regression"]["gasPrice"],
                inData["addressIds"]["operational"],
                inData["commission"]["poolMaster"],
            ]
        );
        const initLogicResult = await retryTransaction(
            () => poolMasterConfigProxy.connect(creator).functions.initLogicAndCall(
                poolMasterConfigLogic.address,
                configInitData
            ),
            "Initialize poolMasterConfigProxy logic (atomic)"
        );
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
        const grantUserRoleDeployerResult = await retryTransaction(
            () => storage.connect(creator).functions.grantUserRole(poolMasterDeployerProxy.address),
            "Grant user role for poolMasterDeployerProxy"
        );
        const grantAdminRoleDeployerResult = await retryTransaction(
            () => storage.connect(creator).functions.grantAdminRole(poolMasterDeployerProxy.address),
            "Grant admin role for poolMasterDeployerProxy"
        );
        console.log("-> poolMasterDeployerLogic address:", poolMasterDeployerLogic.address)
        console.log("-> poolMasterDeployerProxy address:", poolMasterDeployerProxy.address);
        let estimated;

        const deployerInitData = poolMasterDeployerLogic.interface.encodeFunctionData(
            "initialize",
            [
                poolMasterConfigProxy.address
            ]
        );
        estimated = await poolMasterDeployerProxy.connect(creator)
            .estimateGas.initLogicAndCall(poolMasterDeployerLogic.address, deployerInitData);
        console.log("---> estimatedGas for deployer initLogicAndCall:", estimated.toString())
        const initDeployerLogicResult = await retryTransaction(
            () => poolMasterDeployerProxy.connect(creator).functions.initLogicAndCall(
                poolMasterDeployerLogic.address,
                deployerInitData,
                {gasLimit: estimated.toString()}
            ),
            "Initialize poolMasterDeployerProxy logic (atomic)"
        );
    // Attach for convenience; already initialized atomically above
    let poolMasterDeployer = poolMasterDeployerLogic.attach(poolMasterDeployerProxy.address)

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