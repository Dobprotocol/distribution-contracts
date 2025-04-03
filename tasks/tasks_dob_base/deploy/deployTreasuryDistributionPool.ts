import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import { contractAt } from "../../utils/contract-utils";
import { findEvent } from "../../utils/transaction";
import { getSigner } from "../../utils/simulation-utils";


interface InPool {
    name: string,
    manual_distribution: boolean,
    time_config: {
        first_distribution_date: number,
        n_distributions: number,
        interval: number
    },
    users: string[],
    shares: string[],
    distribution_tokens: string[],
    owner: string
}

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


task("deployTreasuryDistributionPool", "A task to deploy a new treasury pool")
    .addPositionalParam("configFile", "Path to the config file used for the deploy")
    .addOptionalParam("outputFile", "Path to the output config file. By default uses tasks/outputs/deployRewardPool/output_<datetime>.json", "")
    .addOptionalParam("deployerAddress", "The address that will deploy the pools. Must match the private key from .env file", "0x0")
    .addOptionalParam("estimateOnly", "Only estimate gas usage", "false")
    .setAction(async (taskArgs, hre) => {
        // check files exsits
        if (!fs.existsSync(taskArgs.configFile)) {
            throw new Error("config file does not exist")
        }

        // check deployer address
        const accounts = await hre.ethers.getSigners();
        const deployer = getSigner(taskArgs.deployerAddress, accounts);

        // check output file
        const defaultOutputFolder = path.join(path.dirname(path.dirname(__dirname)), "outputs", "deployRewardPool")
        console.log("defaultOutputFolder ->", defaultOutputFolder)

        const now = new Date();
        let outputFile;
        if (taskArgs.outputFile === "") {
            outputFile = path.join(defaultOutputFolder, `output_${now.toISOString()}.json`);
        } else {
            outputFile = taskArgs.outputFile;
        }

        // check if output folder exists, if not, create
        if (!fs.existsSync(path.dirname(outputFile))) {
            fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        }

        // process input config data
        const inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.configFile), 'utf8'));

        const poolMaster = await contractAt(
            hre, inData["poolMaster"]["deployer"]["contract"],
            inData["poolMaster"]["deployer"]["address"]);

        const poolMasterConfig = await contractAt(
            hre, inData["poolMaster"]["config"]["contract"],
            inData["poolMaster"]["config"]["address"]);

        const poolConfig: InPool = inData["pool_config"]
        if (poolConfig.shares.length === 1 && poolConfig.users.length > 1){
            // repeat shares for number of users
            poolConfig.shares = new Array(poolConfig.users.length).fill(poolConfig.shares[0])
        }

        if (poolConfig.distribution_tokens.length > 0) {
            throw new Error("distribution_tokens must be empty. This script does not support distribution tokens yet")
        }
        let prepay = "0";
        let timeConfig = [0, 0, 0]
        const gasPrice = await hre.ethers.provider.getGasPrice()
        if (!poolConfig.manual_distribution) {
            console.log("iside iff")
            // estimate prepay
            await poolMasterConfig.connect(deployer)
                .functions.getRegressionParams()
                .then(async (res) => {
                    console.log("res:", res)
                    let amount = res.coef.mul(poolConfig.users.length)
                            .add(res.intercept)
                            .mul(poolConfig.time_config.n_distributions)
                            .mul(gasPrice)
                    amount = amount.add(res.intercept)
                    console.log("prepay expected from regression", amount)
                    prepay = amount.toString();
                })
            // get timeConfig array
            timeConfig = [
                poolConfig.time_config.first_distribution_date,
                poolConfig.time_config.n_distributions,
                poolConfig.time_config.interval
            ]
        }

        // generate poolData
        let metadata = {
            "na": poolConfig.name,
            "ma": Number(poolConfig.manual_distribution)
        }

        // estimate creation gas
        let estimated = await poolMaster.connect(deployer)
            .estimateGas.createTreasuryPool(
                poolConfig.users,
                poolConfig.shares,
                timeConfig,
                JSON.stringify(metadata),
                hre.ethers.constants.AddressZero,
                {
                    value: prepay,
                }
        )
        const estimateDeployFee = gasPrice.mul(estimated)
        console.log("Estimated cost for deploy is ->", hre.ethers.utils.formatEther(estimateDeployFee), "Ethers")

        if (taskArgs.estimateOnly === "true") {
            return
        }

        // deploy the pool (use gas estimated x 2)
        let txData0 = await poolMaster.connect(deployer)
            .functions.createTreasuryPool(
                poolConfig.users,
                poolConfig.shares,
                timeConfig,
                JSON.stringify(metadata),
                hre.ethers.constants.AddressZero,
                {
                    value: prepay,
                    gasLimit: estimated.mul(2).toString()
                }
            )
        let resData0 = await txData0.wait()
        let event = findEvent(resData0, "CreatePool")
        console.log("pool deployed to address:", event.args.contractAddress)
        
        //transfer ownership
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
        console.log("transfering ownership from", deployer.address, "to", poolConfig.owner)
        let txData1 = await pool.connect(deployer)
            .functions.transferOwnership(poolConfig.owner)
        let resData1 = await txData1.wait();


        // save data
        let out: OutPool = {
            users: poolConfig.users,
            shares: poolConfig.shares,
            address: event.args.contractAddress,
            tokenAddress: event.args.tokenAddress,
            firstDistribution: timeConfig[0],
            nDistributions: timeConfig[1],
            interval: timeConfig[2],
            owner: poolConfig.owner,
            tx_hash: resData0["transactionHash"],
            gasUsed: resData0["gasUsed"].toString(),
            estimatedGas: estimated.toString(),
            prepay: prepay.toString()
        }


        fs.writeFileSync(outputFile, JSON.stringify(out, null, 2))
    })