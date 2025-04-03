// import { Contract, Signer } from "ethers"
import { ethers } from "ethers";
import { deployerContract, getRangeFirstDayOfMonth } from "./contract-utils";
import * as path from 'path';

// accountCreator: Signer
// hre: Hardhat Runtime Environment (HRE)
export async function deployNewPM(hre, contractName: string,
    accountCreator) {
    let poolMaster = await deployerContract(hre, contractName, {}, false, {}, [],
        accountCreator);
    console.log("Pool master deployed to: ", poolMaster.address);
    return poolMaster;
}

// poolNaster: Contract
// pmCreator: Signer
export async function deployPoolTreshory(hre, poolMaster, pmCreator,
    accounts: string[], shares: number[]): Promise<string> {
    const _name = "Dob Treshory";
    const _durationDays = 1461;

    var startDate = new Date();
    var endDate = new Date();
    endDate = new Date(endDate.setDate(startDate.getDate() + _durationDays));

    const _distributionDates = getRangeFirstDayOfMonth(startDate, endDate);
    const _tokenSymbol = "Dob";
    const _initialSupply = 100000;

    let gasCreatePT = await poolMaster.connect(pmCreator)
        .estimateGas.createPoolToDeposit(
            _name,
            _distributionDates,
            _tokenSymbol,
            accounts,
            shares,
            _initialSupply);

    console.log("Estimate gas for pool trshory creation: ", gasCreatePT);

    let txCreatePt = await poolMaster.connect(pmCreator)
        .functions.createPoolToDeposit(
            _name,
            _distributionDates,
            _tokenSymbol,
            accounts,
            shares,
            _initialSupply,
            { value: gasCreatePT });
    
    let failAddress: string = '0x0000000000000000000000000000000000000000';
    let poolToDepositAddress: string = failAddress;
    console.log("query treasury address, try durring 30 seconds, else, timeout")
    for (let i = 0; i < 10; i++){
        console.log("query pool address")
        await poolMaster.connect(pmCreator)
            .functions.getPoolToDeposit()
            .then((res) => {
                poolToDepositAddress = res[0];
            });
        if (poolToDepositAddress == failAddress){
            console.log("pools address empty, failed query")
            if (i == 6) {
                break;
            } else {
                console.log("sleep 5 seconds and try again");
                await new Promise(f => setTimeout(f, 5000));
            }
        } else {
            console.log("Pool depoyed at: ", poolToDepositAddress);
            return poolToDepositAddress;
        }
    }
    if (poolToDepositAddress == failAddress){
        throw new Error("failed to deploy treasury pool")
    }
    return poolToDepositAddress;
};
// poolNaster: Contract
// pmCreator: Signer
export async function deployPool(hre, poolMaster, pmCreator, expectedPoolsNumber: number,
    accounts: string[], shares: number[], 
    distributionDates: number[] | undefined = [],
    poolName: string = "Example pool name",
    publicAccess: boolean = true,
    gasFirstOperation: Number = 0,
    initialSupply: Number = 100000): Promise<string[]> {
    
    const _name = poolName;
    const _durationDays = 1461;
    
    if (distributionDates === undefined) {
        let startDate = new Date();
        let endDate = new Date();
        endDate = new Date(endDate.setDate(startDate.getDate() + _durationDays));

        distributionDates = getRangeFirstDayOfMonth(startDate, endDate);
    }
    
    const _tokenSymbol = "MTP1";
    console.log("estimate gas for pool creation")
    let gasCreateP = await poolMaster.connect(pmCreator)
        .estimateGas.createPool(
            _name,
            distributionDates,
            _tokenSymbol,
            publicAccess, gasFirstOperation,
            accounts,
            shares,
            initialSupply)
        .catch((err: string) => console.error("Estimate gas for create pool: ", err));
    
    await new Promise(f => setTimeout(f, 5000));
    if (!gasCreateP){
        gasCreateP = ethers.BigNumber.from("4000000")
    }
    console.log("Estimate gas for pool creation: ", gasCreateP);
    console.log("create pool")
    console.log(_name, distributionDates, _tokenSymbol, publicAccess, gasFirstOperation, accounts, shares, initialSupply);
    await poolMaster.connect(pmCreator)
        .functions.createPool(
            _name,
            distributionDates,
            _tokenSymbol,
            publicAccess, gasFirstOperation,
            accounts,
            shares,
            initialSupply,
            { gasLimit: 5800000, value: gasCreateP });

    console.log("query pool address, try durring 30 seconds, else, timeout")
    let poolsAddress: string[] = [];
    for (let i = 0; i < 10; i++){
        console.log("query pool address")
        poolsAddress = [];
        await poolMaster.queryFilter(poolMaster.filters.CreatePool())
            .then((res) => {
                for (let i = 0; i < res.length; i++) {
                    if (res[i].args === undefined) {
                        console.log("Something wrong happened");
                    } else {
                        poolsAddress.push(res[i].args.contractAddress);
                    }

                }
            }).catch((err) => console.error("event createPool :", err));
        if (poolsAddress.length != expectedPoolsNumber+1){
            console.log("failed query")
            if (i == 6) {
                break;
            } else {
                console.log("sleep 5 seconds and try again");
                await new Promise(f => setTimeout(f, 5000));
            }
        } else {
            console.log("Pool depoyed at: ", poolsAddress[poolsAddress.length - 1]);
            return poolsAddress;
        }
    }

    // console.log("wait 5 sec")
    // await new Promise(f => setTimeout(f, 5000));
    // console.log("query pool address")
    // let poolsAddress: string[] = [];
    // await poolMaster.queryFilter(poolMaster.filters.CreatePool())
    //     .then((res) => {
    //         for (let i = 0; i < res.length; i++) {
    //             if (res[i].args === undefined) {
    //                 console.log("Something wrong happened");
    //             } else {
    //                 poolsAddress.push(res[i].args.contractAddress);
    //             }

    //         }
    //     }).catch((err) => console.error("event createPool :", err));
    // console.log("Pool depoyed at: ", poolsAddress[poolsAddress.length - 1]);
    return poolsAddress;
}

export function checkCreatorAddress(accounts, inData): boolean{
    let addressFromPriv = accounts[inData["addressIds"]["creator"]].address;
    let addressExpected = inData["addressIds"]["creatorExpected"]
    if (addressFromPriv != addressExpected){
        console.log(
            "creator address priv key does not match expected address", 
            "expected:", addressExpected,
            "current:", addressFromPriv
        )
        return false;
    }
    return true;
}
