import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import { contractAt, deployerContract } from "./subtasks/utils/contract-utils";
import { findEvent } from "./subtasks/utils/transaction";
import { getSigner } from "./subtasks/utils/simulation-utils";

// function a(){

// }

interface OutPool {
    users?: string[],
    shares?: string[],
    prepay?: string,
    estimatedGas?: string,
    tx_hash?: string,
    gasUsed?: string,
    address?: string,
    tokenAddress?: string,
    firstDistribution?: number,
    nDistributions?: number,
    interval?: number,
    owner?: string
}


task("deployPools", "A task to deploy a set of pools")
    .addPositionalParam("inputConfigFile", "Name of the input config to use")
    .addPositionalParam("outputConfigFile", "name of the file where the deploy data will be stored")
    .setAction(async (taskArgs, hre) => {

        // get main variables
        // account
        const accounts = await hre.ethers.getSigners();
        const outputConfigFile = path.join(
            __dirname, "deploys", 
            taskArgs.outputConfigFile);

        const inputConfigFile = path.join(
                __dirname, "configs", 
                taskArgs.inputConfigFile);
        const inData = JSON.parse(fs.readFileSync(
            path.join(inputConfigFile), 'utf8'));

        const poolMaster = await contractAt(
            hre, inData["poolMaster"]["deployer"]["contract"], 
            inData["poolMaster"]["deployer"]["address"]);

        const poolMasterConfig = await contractAt(
            hre, inData["poolMaster"]["config"]["contract"], 
            inData["poolMaster"]["config"]["address"]);
        
        const deployer = accounts[0];
        console.log("deployer address is:", deployer.address)

        let firstDate = Math.floor(Date.now()/1000);
        let outPools: OutPool[] = []
        for (let i = 0; i < inData["pools"].length; i++){
            let poolData = inData["pools"][i]
            console.log("poolData is", poolData)
            let _out: OutPool = {
                users: poolData["users"],
                shares: poolData["shares"]
            }

            // estimate prepay
            await poolMasterConfig.connect(deployer)
                .functions.getRegressionParams()
                .then((res) => {
                    console.log("res:", res)
                    let amount = res.coef.mul(poolData["users"].length).add(res.intercept).mul(poolData["nDistributions"]).mul("5000000000")
                    amount = amount.add(res.intercept)
                    console.log("prepay expected from regression", amount)
                })
            let prepay;
            await poolMasterConfig.connect(deployer)
                .functions.expectedTotalGas(poolData["users"].length, poolData["nDistributions"])
                .then((res) => {
                    console.log("prepay expected from function:", res.amount.toString())
                    prepay = res.amount;
                })
            _out.prepay = prepay.toString()

            // define time config
            let timeConfig: number[];
            let metadata = {
                "na": poolData["name"],
                "ma": 0
            }
            if ("manual" in poolData && poolData["manual"]){
                timeConfig = []
                metadata["ma"] = 1
            } else {
                try {
                    timeConfig = [
                        firstDate,
                        poolData["nDistributions"],
                        poolData["interval"]
                    ]
                } catch (error) {
                    console.log("failed to generate timeConfig, using empty")
                    timeConfig = []
                }
            }
            // estimate creation gas
            console.log("estimate creation gas with address", deployer.address, "and prepay", prepay)
            let estimated = await poolMaster.connect(deployer)
                .estimateGas.createTreasuryPool(
                    poolData["users"],
                    poolData["shares"],
                    timeConfig,
                    JSON.stringify(metadata),
                    {
                        value: prepay.toString(),
                    }
                )
            _out.estimatedGas = estimated.toString()
            console.log("estimated gas for deploy is:", estimated.toString())

            // deploy
            let txData = await poolMaster.connect(deployer)
                .functions.createTreasuryPool(
                    poolData["users"],
                    poolData["shares"],
                    timeConfig,
                    JSON.stringify(metadata),
                    {
                        value: prepay.toString(),
                        gasLimit: estimated.mul(2).toString()
                    }
                )
            let resData = await txData.wait()
            console.log("pool", i, poolData["name"], "deployed")
            _out.tx_hash = resData["transactionHash"]
            _out.gasUsed = resData["gasUsed"].toString()
            // capture proxy address
            let event = findEvent(resData, "CreatePool")
            console.log("pool deployed to address:", event.args.contractAddress)
            let logicAddress;
            let logicContract;
            await poolMasterConfig.functions.getLatestVersion()
                .then((res) => {
                    logicAddress = res._logic
                    logicContract = res._name
                })
            let logic = await contractAt(
                hre, logicContract, logicAddress);
            let pool = logic.attach(event.args.contractAddress);
            
            await pool.functions.owner().then((res) => {
                console.log("the current owner is:", res, "and deployer address was:", deployer.address)
            })
            // transfer ownership
            console.log("transfer ownership from", deployer.address, "to", poolData["users"][0])
            txData = await pool.connect(deployer)
                .functions.transferOwnership(poolData["users"][0])
            resData = await txData.wait();

            _out.address = event.args.contractAddress;
            _out.tokenAddress = event.args.tokenAddress;
            _out.firstDistribution = firstDate;
            _out.nDistributions = poolData["nDistributions"],
            _out.interval = "interval" in poolData ? poolData["interval"] : -1
            _out.owner = (await pool.functions.owner())[0];
            
            outPools.push(_out);
        }
        fs.writeFileSync(outputConfigFile, JSON.stringify({outPools: outPools}, null, 2))
    })