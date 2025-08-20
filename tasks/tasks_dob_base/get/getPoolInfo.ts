import { task } from "hardhat/config";
import * as path from 'path';
import { contractAt } from "../../utils/contract-utils";

task("getPoolInfo", "get pool info")
    .addPositionalParam("poolAddress", "the address of the pool to get info")
    .setAction(async (taskArgs, hre) => {

        let proxy = await contractAt(hre, "LogicProxy", taskArgs.poolAddress);
        console.log("proxy contract -> ", proxy.address)
        const implementation = (await proxy.functions.getImplementation())[0]
        console.log("proxy implementation ->", implementation)

        let logic = await contractAt(hre, "DistributionPool", implementation)
        let pool = logic.attach(taskArgs.poolAddress)
        console.log("pool instance ->", pool.address)


        await pool.functions.getTotalDistAmount(hre.ethers.constants.AddressZero)
            .then((res) => {
                console.log("the total dist amount available is:", hre.ethers.utils.formatEther(res[0]))
            })

        await pool.functions.getPrepayAmount()
            .then((res) => {
                console.log("the total prepay amount available is:", hre.ethers.utils.formatEther(res[0]))
            })

        await pool.functions.getRegressionParams()
            .then((res) => {
                console.log("getRegressionParams coef:", hre.ethers.utils.formatEther(res._coef))
                console.log("getRegressionParams intercept:", hre.ethers.utils.formatEther(res._intercept))
            })

    })