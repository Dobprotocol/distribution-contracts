import { task } from "hardhat/config";
import * as path from 'path';
import { contractAt } from "../../utils/contract-utils";

task("getProxyImplementation", "get the proxy implementation address")
    .addPositionalParam("address", "the address of proxy contract")
    .setAction(async (taskArgs, hre) => {
        let proxy = await contractAt(hre, "LogicProxy", taskArgs.address);
        console.log("proxy contract -> ", proxy.address)
        const implementation = (await proxy.functions.getImplementation())[0]
        console.log("proxy implementation ->", implementation)

    })