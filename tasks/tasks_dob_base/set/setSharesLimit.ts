import { task } from "hardhat/config";
import * as path from 'path';
import { contractAt } from "../../utils/contract-utils";
import { getSigner } from "../../utils/simulation-utils";

task("setSharesLimit", "set the shares limit in the poolMasterConfig")
    .addPositionalParam("address", "the address of the poolMasterConfig")
    .addPositionalParam("owner", "the address of the owner of the poolMasterConfig. Must be present in .env private keys")
    .addPositionalParam("sharesLimit", "the shares limit to set")
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners();
        const owner = getSigner(taskArgs.owner, accounts);

        let proxy = await contractAt(hre, "LogicProxy", taskArgs.address);
        console.log("proxy contract -> ", proxy.address)
        const implementation = (await proxy.functions.getImplementation())[0]
        console.log("proxy implementation ->", implementation)

        let logic = await contractAt(hre, "PoolMasterConfig", implementation)
        let pmc = logic.attach(taskArgs.address)
        console.log("poolMasterConfig instance ->", pmc.address)
        

        // set
        let res = await pmc.connect(owner).functions.setSharesLimit(taskArgs.sharesLimit)
        let tx = await res.wait()
        console.log("Transaction complete, hash:", tx.transactionHash)

    })