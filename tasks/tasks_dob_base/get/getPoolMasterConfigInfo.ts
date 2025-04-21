import { task } from "hardhat/config";
import * as path from 'path';
import { contractAt } from "../../utils/contract-utils";

task("getPoolMasterConfigInfo", "get poolMasterConfig info")
    .addPositionalParam("address", "the address of the poolMasterConfig")
    .setAction(async (taskArgs, hre) => {

        let proxy = await contractAt(hre, "LogicProxy", taskArgs.address);
        console.log("proxy contract -> ", proxy.address)
        const implementation = (await proxy.functions.getImplementation())[0]
        console.log("proxy implementation ->", implementation)

        let logic = await contractAt(hre, "PoolMasterConfig", implementation)
        let pmc = logic.attach(taskArgs.address)
        console.log("poolMasterConfig instance ->", pmc.address)

        await pmc.functions.getCommission()
            .then((res) => {
                console.log("the commission is:", res[0].toString())
            })

        await pmc.functions.getOperationalAddress()
            .then((res) => {
                console.log("the operational address is:", res[0])
            })

        await pmc.functions.getSharesLimit()
            .then((res) => {
                console.log("the shares limit is:", res[0].toString())
        })

        await pmc.functions.getRegressionParams()
            .then((res) => {
                console.log("getRegressionParams coef:", res.coef.toString())
                console.log("getRegressionParams intercept:", res.intercept.toString())
            })
        // function getLatestVersion() external view returns(address _logic, string memory _name);
        await pmc.functions.getLatestVersion()
            .then((res) => {
                console.log("getLatestVersion logic:", res[0])
                console.log("getLatestVersion name:", res[1])
            })
        // function getLatestVersionNumber() external view returns(uint256);
        await pmc.functions.getLatestVersionNumber()
            .then((res) => {
                console.log("getLatestVersionNumber:", res[0].toString())
            })
        

    })