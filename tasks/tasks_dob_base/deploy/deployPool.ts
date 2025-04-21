import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import { contractAt } from "../../utils/contract-utils";
import { findEvent } from "../../utils/transaction";
import { getSigner } from "../../utils/simulation-utils";

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


task("deployPool", "A task to deploy a pool")
    .addPositionalParam("deployFile", "Path to the deploy file")
    .addPositionalParam("poolFile", "Path to the pool config file")
    .addPositionalParam("deployer", "The address that will deploy the contracts. Must match the private key from .env file")
    .addOptionalParam("outputFile", "Path to the output config file. By default uses tasks/outputs/deployPool/output_<datetime>.json", "")
    .addOptionalParam("estimateOnly", "if enabled, it will only estimate the deployment cost", "false")
    .setAction(async (taskArgs, hre) => {
        // check files exsits
        if (!fs.existsSync(taskArgs.deployFile)){
            throw new Error("deploy file does not exist")
        }
        if (!fs.existsSync(taskArgs.poolFile)){
            throw new Error("pool file does not exist")
        }

        let deployData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.deployFile), 'utf8'));

        let poolData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.poolFile), 'utf8'));

        // check shares
        if (poolData["shares"].length === 1 && poolData["users"].length > 1){
            // repeat shares for number of users
            poolData["shares"] = new Array(poolData["users"].length).fill(poolData["shares"][0])
        }

        // check deployer address
        const accounts = await hre.ethers.getSigners();
        const deployer = getSigner(taskArgs.deployer, accounts);

        // check output file
        const defaultOutputFolder = path.join(path.dirname(path.dirname(__dirname)), "outputs", "deployPool")
        console.log("defaultOutputFolder ->", defaultOutputFolder)
        const now = new Date();
        let outputFile;
        if (taskArgs.outputFile === ""){
            outputFile=path.join(defaultOutputFolder, `output_${now.toISOString()}.json`);
        } else {
            outputFile = taskArgs.outputFile;
        }
        // check if output folder exists, if not, create
        if (!fs.existsSync(path.dirname(outputFile))){
            fs.mkdirSync(path.dirname(outputFile), {recursive: true});
        }

        // instanciate pool master
        const poolMaster = await contractAt(
            hre, deployData["poolMaster"]["deployer"]["contract"], 
            deployData["poolMaster"]["deployer"]["address"]);

        const poolMasterConfig = await contractAt(
            hre, deployData["poolMaster"]["config"]["contract"], 
            deployData["poolMaster"]["config"]["address"]);

        // estimate prepay
        let prepay = "0";
        if (!poolData["manual_distribution"]){
            await poolMasterConfig.connect(deployer)
                .functions.getRegressionParams()
                .then((res) => {
                    console.log("res:", res)
                    console.log("users len", poolData["users"].length)
                    console.log("n dists", poolData["time_config"]["n_distributions"])
                    let nUsers = hre.ethers.BigNumber.from(poolData["users"].length)
                    let nDistributions =hre.ethers.BigNumber.from(poolData["time_config"]["n_distributions"])
                    console.log("nUsers:", nUsers)
                    console.log("nDistributions:", nDistributions)
                    let amount = res.coef.mul(nUsers).add(res.intercept).mul(nDistributions).mul(res.gasPrice)
                    amount = amount.add(res.intercept)
                    console.log("prepay expected from regression", hre.ethers.utils.formatEther(amount))
                    prepay = amount.toString();
                })
        }

        // define time config
        let timeConfig: number[] ;
        let metadata = {
            "na": poolData["name"],
            "ma": Number(poolData["manual_distribution"])
        }
        if (poolData["manual_distribution"]){
            timeConfig = []
        } else {
            timeConfig = [
                poolData["time_config"]["first_distribution_date"],
                poolData["time_config"]["n_distributions"],
                poolData["time_config"]["interval"]
            ]
        }

        // estimate creation gas
        let estimated;
        if (poolData["type"] == "treasury"){
            estimated = await poolMaster.connect(deployer)
                .estimateGas.createTreasuryPool(
                    poolData["users"],
                    poolData["shares"],
                    timeConfig,
                    JSON.stringify(metadata),
                    hre.ethers.constants.AddressZero,
                    {
                        value: prepay,
                    }
                )
        } else if (poolData["type"] === "payroll"){
            estimated = await poolMaster.connect(deployer)
                .estimateGas.createPayrollPool(
                    poolData["users"],
                    poolData["shares"],
                    timeConfig,
                    poolData["goal"],
                    JSON.stringify(metadata),
                    {
                        value: prepay,
                    }
                )
        } else if (poolData["type"] === "reward"){
            estimated = await poolMaster.connect(deployer)
                .estimateGas.createRewardPool(
                    poolData["users"],
                    poolData["shares"],
                    poolData["goal"],
                    JSON.stringify(metadata),
                    hre.ethers.constants.AddressZero,
                    {
                        value: "0",
                    }
                )
        } else {
            throw new Error(`invalid pool type ${poolData["type"]}`)
        }
        console.log("estimated gas for deploy is:", estimated.toString())
        if (taskArgs.estimateOnly === "true"){
            return;
        }
        // deploy
        let res;
        let tx;

        if (poolData["type"] == "treasury"){
            res = await poolMaster.connect(deployer).functions
                .createTreasuryPool(
                    poolData["users"],
                    poolData["shares"],
                    timeConfig,
                    JSON.stringify(metadata),
                    hre.ethers.constants.AddressZero,
                    {
                        value: prepay,
                        gasLimit: estimated.mul(2).toString(),
                    }
                )
        } else if (poolData["type"] === "payroll"){
            res = await poolMaster.connect(deployer).functions
                .createPayrollPool(
                    poolData["users"],
                    poolData["shares"],
                    timeConfig,
                    poolData["goal"],
                    JSON.stringify(metadata),
                    {
                        value: prepay,
                        gasLimit: estimated.mul(2).toString(),
                    }
                )
        } else if (poolData["type"] === "reward"){
            res = await poolMaster.connect(deployer).functions
                .createRewardPool(
                    poolData["users"],
                    poolData["shares"],
                    poolData["goal"],
                    JSON.stringify(metadata),
                    hre.ethers.constants.AddressZero,
                    {
                        value: "0",
                        gasLimit: estimated.mul(2).toString(),
                    }
                )
        } else {
            throw new Error(`invalid pool type ${poolData["type"]}`)
        }
        console.log("executed function hash should be:", res.hash)
        tx = await res.wait()
        console.log("deploy tx hash:", tx.transactionHash)
        let event = findEvent(tx, "CreatePool")
        console.log("pool deployed to address:", event.args.contractAddress)

        // transfer ownership
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

        let resData1 = await pool.connect(deployer)
            .functions.transferOwnership(poolData["owner"])
        let txData1 = await resData1.wait();
        console.log("transfer ownership tx hash:", txData1.transactionHash) 

        let _out: OutPool = {
            users: poolData["users"],
            shares: poolData["shares"],
            prepay: prepay,
            estimatedGas: estimated.toString(),
            tx_hash: tx.transactionHash,
            gasUsed: tx.gasUsed.toString(),
            address: event.args.contractAddress,
            tokenAddress: hre.ethers.constants.AddressZero,
            firstDistribution: timeConfig[0],
            nDistributions: timeConfig[1],
            interval: timeConfig[2],
            owner: poolData["owner"]
        }

        fs.writeFileSync(outputFile, JSON.stringify(_out, null, 2))

    })