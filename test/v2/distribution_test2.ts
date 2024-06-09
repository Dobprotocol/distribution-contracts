import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, Signer } from "ethers"
import {expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployStorage, deployPoolLogic, deployPoolMaster, deployParticipationPool, deployExternalToken} from "../utils/deploys";
import { getNextDistributionDate, simulateDistribution } from "../utils/pools";


describe("test distribution amounts when doing pool distributions", function () {
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
        distributionInterval = 20000;
        firstDistributionDate = Math.floor(Date.now() / 1000) - distributionInterval * 5 - 567;

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

        console.log("::::::::: pre-test done :::::::::")
    })
    it ("test currency distribution to 2 users", async function () {
        poolOwner = accounts[2];
        poolUsers = [accounts[2].address, accounts[3].address];
        poolShares = [860, 140];

        pool = await deployParticipationPool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, firstDistributionDate, 999,
            distributionInterval
        );
        let amount = ethers.utils.parseEther("1");
        // deposit 1 eth
        console.log("--> deposit some funds...")
        let txData = await pool.connect(accounts[10])
            .functions.deposit({value: amount.toString()})
        // do distribution
        console.log("--> do a distribution")
        txData = await pool.connect(poolOwner)
            .functions.distribute(poolUsers, ethers.constants.AddressZero);

        let expectedDistribution = await simulateDistribution(pool, amount, poolUsers, poolShares);

        for (let i = 0; i < poolUsers.length; i++){
            let assignedDist = await pool.connect(accounts[10])
                .functions.getUserAmounts(poolUsers[i], ethers.constants.AddressZero)
            console.log(
                "addr", poolUsers[i], 
                "distributed ammount", assignedDist.toString(), 
                "expected", expectedDistribution[i].toString());
            expect(assignedDist.toString()).to.equal(expectedDistribution[i].toString());
        }
    })
    it ("test external token distribution to 5 users", async function () {
        poolOwner = accounts[2];
        poolUsers = [];
        for (let i = 2; i < 2 + 5; i++){
            poolUsers.push(accounts[i].address);
        }
        poolShares = [860, 140, 560, 435, 5];
        let extToken = await deployExternalToken(
            accounts[11], "testToken", "TTD", ethers.utils.parseEther("10").toString())

        pool = await deployParticipationPool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, firstDistributionDate, 999,
            distributionInterval
        );

        await pool.connect(poolOwner)
            .functions.addExternalToken(extToken.address)

        let amount = ethers.utils.parseEther("1");
        // deposit 1 token
        console.log("--> deposit some funds...")
        await extToken.connect(accounts[11])
            .functions.transfer(pool.address, amount.toString())
        // deposit 4.563 token
        let amount2 = ethers.utils.parseEther("4.563");
        amount = amount.add(amount2);
        await extToken.connect(accounts[11])
            .functions.transfer(pool.address, amount2.toString())
        // do distribution
        console.log("--> do a distribution")
        await pool.connect(poolOwner)
            .functions.distribute(poolUsers, extToken.address);
        
        let expectedDistribution = await simulateDistribution(pool, amount, poolUsers, poolShares);

        for (let i = 0; i < poolUsers.length; i++){
            let assignedDist = await pool.connect(accounts[10])
                .functions.getUserAmounts(poolUsers[i], extToken.address)
            console.log(
                "addr", poolUsers[i], 
                "distributed ammount", assignedDist.toString(), 
                "expected", expectedDistribution[i].toString());
            expect(assignedDist.toString()).to.equal(expectedDistribution[i].toString());
        }
    })
})