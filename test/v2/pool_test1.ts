import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, Signer } from "ethers"
import {expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployStorage, deployPoolLogic, deployPoolMaster, deployParticipationPool, deployExternalToken, deployTreasuryTypePool} from "../utils/deploys";
import { getNextDistributionDate, getSigner, simulateDistribution } from "../utils/pools";

describe("test limit cases for distributions of participation pools", function(){
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
    let _v2: Contract;
    let pool: Contract;

    beforeEach(async function (){
        accounts = await ethers.getSigners();
        creator = accounts[0];
        operational = accounts[1];
        poolOwner = accounts[2];
        poolUsers = [accounts[2].address, accounts[3].address, accounts[4].address];
        poolShares = [860, 594, 546];
        distributionInterval = 20000;
        firstDistributionDate = Math.floor(Date.now() / 1000) - distributionInterval * 5 - 567;

        console.log("::::: pre-test deploys ::::::")
        // console.log("1. deploy storage, pool master, and logic")
        _storage = await deployStorage(creator);
        [_pm, _pmc] = await deployPoolMaster(creator, _storage);
        _v1 = await deployPoolLogic(_storage, creator, "DistributionPool");
        _v2 = await deployPoolLogic(_storage, creator, "ParticipationPoolV2");

        // console.log("2. initialize poolmaster")
        await _pmc.connect(creator)
            .functions.initialize(1, 1, 1, operational.address, 300);
        await _pm.connect(creator)
            .functions.initialize(_pmc.address);
        // console.log("3. add logic version 1")
        await _pmc.connect(creator)
            .functions.addLogicVersion(
                _v1.address, 1, "DistributionPool"
            )
        // console.log(
        //     "->latest logic version:", 
        //     await _pm.connect(accounts[10]).functions.getLatestVersion())

        // console.log("4. create treasury pool")
        await _pm.connect(creator)
            .functions.createPoolMasterTreasuryPool([operational.address], [100], '');
        
        pool = await deployParticipationPool(
            _pm,_pmc, poolOwner, poolUsers, poolShares, firstDistributionDate, 999,
            distributionInterval
        );
        console.log("::::::::: pre-test done :::::::::")

    })
    // it("evaluate that distributions can be made by external accounts", async function(){
    //     let acc = accounts[11];
    //     expect(poolUsers).to.not.includes(acc.address);

    //     // deposit funds to make a distribution
    //     let txData = await pool.connect(accounts[10])
    //         .functions.deposit({value: ethers.utils.parseEther("1").toString()})
    //     // do a manual distribution with non-participant nor owner nor operational account
    //     await pool.connect(acc)
    //         .functions.distribute(poolUsers, ethers.constants.AddressZero)
    //     // everything should work ok
    // })
    it("evaluat that distributions cannot be made if there is no amount to distribute", async function(){
        let acc = poolOwner;
        // expect(poolUsers).to.not.includes(acc.address);

        // do a manual distribution without funds to distribute
        let _before = await ethers.provider.getBalance(acc.address)
        await expect(
            pool.connect(acc)
                .functions.distribute(poolUsers, ethers.constants.AddressZero)
        ).to.be.rejectedWith("There is no amount to distribute")
        let _after = await ethers.provider.getBalance(acc.address)
        expect(_before.sub(_after).toString()).to.not.equal("0");
    })
    it("evaluate that distributions reject for invalid tokens", async function(){

        let extToken = await deployExternalToken(
            accounts[11], "testToken", "TTD", ethers.utils.parseEther("10").toString())

        // let _before = await ethers.provider.getBalance(accounts[3].address)
        await expect(
            pool.connect(poolOwner)
                .functions.distribute(poolUsers, extToken.address)
        ).to.be.rejectedWith("token is not set for distribution")
        // let _after = await ethers.provider.getBalance(accounts[3].address)
        // expect(_before.sub(_after).toString()).to.not.equal("0");
    })
    it("evaluate that distributions cannot happens if the total shares of the targer address is not 100%", async function(){
        // let _before = await ethers.provider.getBalance(accounts[3].address)
        await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})
        let copy = poolUsers;
        copy.pop()
        await expect(
            pool.connect(poolOwner)
                .functions.distribute(copy, ethers.constants.AddressZero)
        ).to.be.rejectedWith("Must Match 100% participation to distribute")
        // let _after = await ethers.provider.getBalance(accounts[3].address)
        // expect(_before.sub(_after).toString()).to.not.equal("0");

        copy = poolUsers;
        copy.push(poolUsers[0])
        await expect(
            pool.connect(poolOwner)
                .functions.distribute(copy, ethers.constants.AddressZero)
        ).to.be.rejectedWith("Must Match 100% participation to distribute")
    })
    it("evaluate that distributions from operational address cannot proceed without prepayment", async function(){
        let pool2 = await deployParticipationPool(
            _pm,_pmc, poolOwner, poolUsers, poolShares, firstDistributionDate, 999,
            distributionInterval
        );
        await pool2.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})
        expect(
            pool2.connect(operational)
                .functions.distribute(poolUsers, ethers.constants.AddressZero)
        ).to.be.rejectedWith("Not enough prepay to pay for distribution gas")
    })
    it("evaluate that cannot add duplicated tokens to distribute", async function (){
        let extToken1 = await deployExternalToken(
            accounts[11], "testTokenA", "TTA", ethers.utils.parseEther("10").toString())

        let extToken2 = await deployExternalToken(
            accounts[11], "testTokenB", "TTB", ethers.utils.parseEther("10").toString())

        await pool.connect(poolOwner)
            .functions.addExternalToken(extToken1.address);

        await expect(
            pool.connect(poolOwner)
                .functions.addExternalToken(extToken1.address)
        ).to.be.rejectedWith("External token already set")

        await expect(
            pool.connect(poolOwner)
                .functions.addExternalTokenWithConfig(
                    extToken1.address,
                    firstDistributionDate + 100,
                    100,
                    distributionInterval - 500,
                    0
                )
        ).to.be.rejectedWith("External token already set")

        await pool.connect(poolOwner)
            .functions.addExternalTokenWithConfig(
                extToken2.address,
                firstDistributionDate + 100,
                100,
                distributionInterval - 500,
                0
            )
    })
    it("evaluate that updates logic does not affect in-progress distributions", async function(){
        let acc = poolOwner;
        // deposit funds to make a distribution
        let txData = await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})
        // do a manual distribution with non-participant nor owner nor operational account
        await pool.connect(acc)
            .functions.distribute(poolUsers, ethers.constants.AddressZero)
        let _before = await pool.connect(getSigner(poolUsers[1], accounts))
            .functions.getUserAmounts(poolUsers[1], ethers.constants.AddressZero)

        await _pmc.connect(creator)
            .functions.addLogicVersion(
                _v2.address, 2, "ParticipationPoolV2"
            )
        let logicAddress;
        await _pmc.connect(accounts[3])
            .functions.getLatestVersion()
            .then((res) =>{
                logicAddress = res._logic;
            })
        let prevLogicAddress = await pool.connect(poolOwner).functions.getImplementation();
        expect(prevLogicAddress[0]).to.not.equal(logicAddress);

        await pool.connect(poolOwner)
            .functions.upgradeTo(logicAddress)
        let afterLogicAddress = await pool.connect(poolOwner).functions.getImplementation();
        expect(logicAddress).to.equal(afterLogicAddress[0]);

        let _after = await pool.connect(getSigner(poolUsers[1], accounts))
            .functions.getUserAmounts(poolUsers[1], ethers.constants.AddressZero)
        expect(_after[0]).to.equal(_before[0]);
        
    })
    it("evaluate that only admins can withdraw commissions", async function(){
        let acc = poolOwner;
        // deposit funds to make a distribution
        let txData = await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})
        // do a manual distribution with non-participant nor owner nor operational account
        await pool.connect(acc)
            .functions.distribute(poolUsers, ethers.constants.AddressZero)

        let extToken1 = await deployExternalToken(
            accounts[11], "testTokenA", "TTA", ethers.utils.parseEther("10").toString())

        await expect(
            pool.connect(accounts[11])
                .functions.withdrawTokenCommissions(ethers.constants.AddressZero)
        ).to.be.rejectedWith("You are not admin")
        
        await expect(
            pool.connect(accounts[11])
                .functions.withdrawTokenCommissions(extToken1.address)
        ).to.be.rejectedWith("You are not admin")

    })
    it("evaluate that only participants can withdraw rewards", async function (){
        let acc = poolOwner;
        // deposit funds to make a distribution
        let txData = await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})
        // do a manual distribution with non-participant nor owner nor operational account
        await pool.connect(acc)
            .functions.distribute(poolUsers, ethers.constants.AddressZero)

        let extToken1 = await deployExternalToken(
            accounts[11], "testTokenA", "TTA", ethers.utils.parseEther("10").toString())

        await expect(
            pool.connect(accounts[11])
                .functions.withdrawToken(ethers.constants.AddressZero)
        ).to.be.rejectedWith("You have no participation")
        
        await expect(
            pool.connect(accounts[11])
                .functions.withdrawToken(extToken1.address)
        ).to.be.rejectedWith("You have no participation")

    })
    it("evaluate that only owner can set the regression params", async function (){
        await expect(
            pool.connect(accounts[11])
                .functions.setOperationalAddress(accounts[12].address)
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'Ownable: caller is not the owner'")
    })
    it("evaluate that only the owner can update the operational address", async function(){
        await expect(
            pool.connect(accounts[11])
                .functions.setRegressionParams(10, 1246)
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'Ownable: caller is not the owner'")
    })
    it("evaluate that owner can transfer ownership and keep being participant", async function(){
        await expect(
            pool.connect(accounts[11])
                .functions.transferOwnership(accounts[11].address)
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'Ownable: caller is not the owner'")
    })
})