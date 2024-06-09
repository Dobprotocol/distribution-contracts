import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, Signer, BigNumber } from "ethers"
import {expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployStorage, deployPoolLogic, deployPoolMaster, deployTreasuryTypePool, deployExternalToken} from "../utils/deploys";
import { getNextDistributionDate, simulateDistribution, getSigner} from "../utils/pools";

describe("test multiple withdraws from distributions", function (){
    let accounts: SignerWithAddress[];
    let creator: SignerWithAddress;
    let operational: SignerWithAddress;
    let poolOwner: SignerWithAddress;
    let poolUsers: string[];
    let poolShares: number[];
    let distributionInterval: number;
    let firstDistributionDate: number;

    let _storage: Contract;
    let _pm: Contract;
    let _pmc: Contract;
    let _v1: Contract;
    let pool: Contract;

    beforeEach(async function() {
        accounts = await ethers.getSigners();
        creator = accounts[0];
        operational = accounts[1];
        distributionInterval = 1000;
        firstDistributionDate = Math.floor(Date.now() / 1000) - distributionInterval * 10;

        console.log("::::: pre-test deploys ::::::")
        console.log("1. deploy storage, pool master, and logic")
        _storage = await deployStorage(creator);
        [_pm, _pmc] = await deployPoolMaster(creator, _storage);
        _v1 = await deployPoolLogic(_storage, creator, "DistributionPool");

        console.log("2. initialize poolmaster")
        await _pmc.connect(creator)
            .functions.initialize(1, 1, 1, operational.address, 300);
        await _pm.connect(creator)
            .functions.initialize(_pmc.address);
        console.log("3. add logic version 1")
        await _pmc.connect(creator)
            .functions.addLogicVersion(
                _v1.address, 1, "DistributionPool"
            )
        console.log(
            "->latest logic version:", 
            await _pmc.connect(accounts[10]).functions.getLatestVersion())

        console.log("4. create treasury pool")
        await _pm.connect(creator)
            .functions.createPoolMasterTreasuryPool([operational.address], [100], '');
        
        console.log("5. deploy a participation pool")
        poolOwner = accounts[2];
        poolUsers = [
            accounts[2].address, 
            accounts[3].address, 
            accounts[4].address, 
            accounts[5].address
        ];
        poolShares = [660, 140, 199, 1];
        pool = await deployTreasuryTypePool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, firstDistributionDate, 999,
            distributionInterval
        );
        console.log("::::::::: pre-test done :::::::::")
    })
    it("try to withdraw with no funds should revert with 'Insufficient balance'", async function (){
        await expect(
            pool.connect(accounts[5]).functions.withdrawToken(ethers.constants.AddressZero)
        ).to.be.rejectedWith("Insufficient balance");
        
        let extToken = await deployExternalToken(
            accounts[11], "testToken", "TTD", ethers.utils.parseEther("10").toString())
        // the token does not need to be added to the pool to try to withdraw
        // and when trying to withdraw for a token that is not defined in the pool
        // it will always return 'Insufficient balance'
        await expect(
            pool.connect(accounts[5]).functions.withdrawToken(extToken.address)
        ).to.be.rejectedWith("Insufficient balance");
    })
    it("withdraw eth after distribution", async function (){
        let amount = ethers.utils.parseEther("1");
        // deposit 1 eth
        console.log("--> deposit some funds...")
        let txData = await pool.connect(accounts[10])
            .functions.deposit({value: amount.toString()})
        // deposit prepay
        console.log("--> deposit prepay...")
        txData = await pool.connect(accounts[10])
            .functions.depositPrepay({value: ethers.utils.parseEther("0.1").toString()})

        // * Get and save initial balances
        var userInfo: object = {};
        for (let i = 0; i < accounts.length; i++) {
            await ethers.provider.getBalance(accounts[i].address)
                .then((res: BigNumber) => {
                    userInfo[accounts[i].address] = { initialBalance: res };
                });
        }
        // do distribution
        console.log("--> do a distribution")
        txData = await pool.connect(operational)
            .functions.distribute(poolUsers, ethers.constants.AddressZero);
        let expectedAmounts = await simulateDistribution(pool, amount, poolUsers, poolShares, 3);
        console.log("::::::: check withdrawed ammount matches expected amounts :::::::")
        for (let i =0 ; i < expectedAmounts.length; i++){
            let acc = getSigner(poolUsers[i], accounts);
            if (acc == undefined){
                throw "could not find account for i " + i
            }
            txData = await pool.connect(acc).functions.withdrawToken(ethers.constants.AddressZero);
            let resData = await txData.wait();
            // console.log(resData);
            let fee = resData.effectiveGasPrice.mul(resData.cumulativeGasUsed)
            await ethers.provider.getBalance(acc.address)
                .then((res: BigNumber) => {
                    if (acc != undefined){
                        let diff = res.sub(userInfo[acc.address].initialBalance).add(fee)
                        console.log(
                            "---> PoolUser", i, 
                            "distributed ammount", diff.toString(), 
                            "expected", expectedAmounts[i].toString())
                        expect(diff).to.equal(expectedAmounts[i]);
                    }
                })
            
        }
    })
    it ("try two consecutive withdraws after distribute should revert second withdraw", async function (){
        let amount = ethers.utils.parseEther("1");
        // deposit 1 eth
        console.log("--> deposit some funds...")
        let txData = await pool.connect(accounts[10])
            .functions.deposit({value: amount.toString()})
        // deposit prepay
        console.log("--> deposit prepay...")
        txData = await pool.connect(accounts[10])
            .functions.depositPrepay({value: ethers.utils.parseEther("0.1").toString()})

        // * Get and save initial balances
        var userInfo: object = {};
        for (let i = 0; i < accounts.length; i++) {
            await ethers.provider.getBalance(accounts[i].address)
                .then((res: BigNumber) => {
                    userInfo[accounts[i].address] = { initialBalance: res };
                });
        }
        // do distribution
        console.log("--> do a distribution")
        txData = await pool.connect(operational)
            .functions.distribute(poolUsers, ethers.constants.AddressZero);
        // do withdraw
        let acc = getSigner(poolUsers[1], accounts);
        console.log("--> first withdraw")
        txData = await pool.connect(acc).functions.withdrawToken(ethers.constants.AddressZero);
        console.log("--> second witdraw should revert")
        await expect(
            pool.connect(acc).functions.withdrawToken(ethers.constants.AddressZero)
        ).to.be.rejectedWith("Insufficient balance")
    })
})