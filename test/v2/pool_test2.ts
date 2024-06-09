import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, Signer } from "ethers"
import {expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { 
    deployStorage, 
    deployPoolLogic, 
    deployPoolMaster, 
    deployParticipationPool, 
    deployExternalToken,
    deployPayrollPool,
    deployRewardPool,
    deployTreasuryTypePool
} from "../utils/deploys";
import { getNextDistributionDate, getSigner, simulateDistribution } from "../utils/pools";

describe("test functionality of different pool types", function(){
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
    const _poolType = {
        "treasury": 0,
        "payroll": 1,
        "reward": 2
    }

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

    it("create a reward pool with a variable distribution scheme", async function(){
        // let goal: string = ethers.utils.parseUnits("0.1", "ether").toString()
        pool = await deployRewardPool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, "0"
        );
        let acc = poolOwner;

        expect((await pool.getPoolType())).to.equal(_poolType["reward"]);
        expect((await pool.getGoalAmount(ethers.constants.AddressZero))).to.equal("0");

        // then deposit some funds
        await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})
        // deposit more funds
        await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("10").toString()})
        
        // distribute
        
        // only owner can distribute
        await expect(
            pool.connect(accounts[12])
            .functions.distribute(poolUsers, ethers.constants.AddressZero)
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'Only owner can distribute Reward pools'")

        await pool.connect(acc)
            .functions.distribute(poolUsers, ethers.constants.AddressZero)

        let expectedDistribution = await simulateDistribution(
            pool, ethers.utils.parseEther("11"), poolUsers, poolShares);

        for (let i = 0; i < poolUsers.length; i++){
            let assignedDist = await pool.connect(accounts[10])
                .functions.getUserAmounts(poolUsers[i], ethers.constants.AddressZero)
            console.log(
                "addr", poolUsers[i], 
                "distributed ammount", assignedDist.toString(), 
                "expected", expectedDistribution[i].toString());
            expect(assignedDist.toString()).to.equal(expectedDistribution[i].toString());
        }

        // try to transfer 100 wei to account 11 should work
        let participationTokenAddress = await pool.getParticipationToken();
        console.log("participationToken", participationTokenAddress);
        let participationToken = await ethers.getContractAt(
            "ParticipationToken", participationTokenAddress);
        expect(
            (await participationToken.balanceOf(accounts[11].address)).toString()
        ).to.equal("0")
        await participationToken.connect(poolOwner)
                .transfer(accounts[11].address, "100") 
        expect(
            (await participationToken.balanceOf(accounts[11].address)).toString()
        ).to.equal("100")
    })
    it("create a reward pool with a fixed distribution goal", async function (){
        let goal: string = ethers.utils.parseUnits("5", "ether").toString()
        pool = await deployRewardPool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, goal
        );
        let acc = poolOwner;

        expect((await pool.getPoolType())).to.equal(_poolType["reward"]);
        expect((await pool.getGoalAmount(ethers.constants.AddressZero))).to.equal(goal);

        // then deposit some funds
        await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})
        // deposit more funds
        await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("10").toString()})

        expect((await pool.getTotalDistAmount(ethers.constants.AddressZero))).to.equal(
            ethers.utils.parseEther("11").toString()
        )
        // distribute
        
        // only owner can distribute
        await expect(
            pool.connect(accounts[11])
            .functions.distribute(poolUsers, ethers.constants.AddressZero)
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'Only owner can distribute Reward pools'")

        await pool.connect(acc)
            .functions.distribute(poolUsers, ethers.constants.AddressZero)

        expect((await pool.getTotalDistAmount(ethers.constants.AddressZero))).to.equal(
            ethers.utils.parseEther("6").toString()
        )

        let expectedDistribution = await simulateDistribution(
            pool, ethers.utils.parseEther("5"), poolUsers, poolShares);

        for (let i = 0; i < poolUsers.length; i++){
            let assignedDist = await pool.connect(accounts[10])
                .functions.getUserAmounts(poolUsers[i], ethers.constants.AddressZero)
            console.log(
                "addr", poolUsers[i], 
                "distributed ammount", assignedDist.toString(), 
                "expected", expectedDistribution[i].toString());
            expect(assignedDist.toString()).to.equal(expectedDistribution[i].toString());
        }

        // try to transfer 100 wei to account 11 should work
        let participationTokenAddress = await pool.getParticipationToken();
        console.log("participationToken", participationTokenAddress);
        let participationToken = await ethers.getContractAt(
            "ParticipationToken", participationTokenAddress);
        expect(
            (await participationToken.balanceOf(accounts[11].address)).toString()
        ).to.equal("0")
        await participationToken.connect(poolOwner)
                .transfer(accounts[11].address, "100") 
        expect(
            (await participationToken.balanceOf(accounts[11].address)).toString()
        ).to.equal("100")
        
    })
    it("payroll pool, distribute from participating user", async function(){
        let goal: string = ethers.utils.parseUnits("5", "ether").toString()
        pool = await deployPayrollPool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, goal, 0
        );
        let acc = accounts[11];
        console.log("deployed")
        expect((await pool.getPoolType())).to.equal(_poolType["payroll"]);
        expect((await pool.getGoalAmount(ethers.constants.AddressZero))).to.equal(goal);

        // check that token cannot be transferred
        let participationTokenAddress = await pool.getParticipationToken();
        console.log("participationToken", participationTokenAddress);

        let participationToken = await ethers.getContractAt(
            "ParticipationToken", participationTokenAddress);
        
        console.log(
            "balance of", 
            poolOwner.address, 
            await participationToken.balanceOf(poolOwner.address)
        );
        // try to transfer 100 wei should revert
        await expect(
            participationToken.connect(poolOwner)
                .transfer(acc.address, "100") 
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'ERC20Pausable: token transfer while paused'")
        
        // anyone can distribute
        // deposit some funds
        await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})

        expect(
            (await pool.getTotalDistAmount(ethers.constants.AddressZero))
        ).to.equal(ethers.utils.parseEther("1").toString())

        // distribute form participating user less than goal amount should revert
        await expect(
            pool.connect(getSigner(poolUsers[0], accounts))
                .functions.distribute(poolUsers, ethers.constants.AddressZero)
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'There is no amount to distribute'")
            
        // deposit more funds
        await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("4.14").toString()})

        expect(
            (await pool.getTotalDistAmount(ethers.constants.AddressZero))
        ).to.equal(ethers.utils.parseEther("5.14").toString())

        // distribute from participating user with goal achieve should work
        await pool.connect(getSigner(poolUsers[0], accounts))
                .functions.distribute(poolUsers, ethers.constants.AddressZero)
        
        expect(
            (await pool.getTotalDistAmount(ethers.constants.AddressZero))
        ).to.equal(ethers.utils.parseEther("0.14").toString())

        // // validate distributed amounts
        let expectedDistribution = await simulateDistribution(
            pool, ethers.utils.parseEther("5"), poolUsers, poolShares);

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

    it("payroll pool, distribute from non participating user", async function(){
        let goal: string = ethers.utils.parseUnits("5", "ether").toString()
        pool = await deployPayrollPool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, goal, 0
        );
        let acc = accounts[11];
        expect((await pool.getPoolType())).to.equal(_poolType["payroll"]);
        expect((await pool.getGoalAmount(ethers.constants.AddressZero))).to.equal(goal);

        // check that token cannot be transferred
        let participationTokenAddress = await pool.getParticipationToken();
        console.log("participationToken", participationTokenAddress);

        let participationToken = await ethers.getContractAt(
            "ParticipationToken", participationTokenAddress);
        
        console.log(
            "balance of", 
            poolOwner.address, 
            await participationToken.balanceOf(poolOwner.address)
        );
        // try to transfer 100 wei should revert
        await expect(
            participationToken.connect(poolOwner)
                .transfer(acc.address, "100") 
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'ERC20Pausable: token transfer while paused'")
        
        // anyone can distribute
        // deposit some funds
        await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})

        expect(
            (await pool.getTotalDistAmount(ethers.constants.AddressZero))
        ).to.equal(ethers.utils.parseEther("1").toString())

        // distribute form non participating user less than goal amount should revert
        await expect(
            pool.connect(accounts[10])
                .functions.distribute(poolUsers, ethers.constants.AddressZero)
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'There is no amount to distribute'")
            
        // deposit more funds
        await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("4.14").toString()})

        expect(
            (await pool.getTotalDistAmount(ethers.constants.AddressZero))
        ).to.equal(ethers.utils.parseEther("5.14").toString())

        // distribute from non participating user with goal achieve should work
        await pool.connect(accounts[10])
                .functions.distribute(poolUsers, ethers.constants.AddressZero)
        
        expect(
            (await pool.getTotalDistAmount(ethers.constants.AddressZero))
        ).to.equal(ethers.utils.parseEther("0.14").toString())

        // // validate distributed amounts
        let expectedDistribution = await simulateDistribution(
            pool, ethers.utils.parseEther("5"), poolUsers, poolShares);

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

    it("treasury pool, distribute", async function (){
        pool = await deployTreasuryTypePool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, 0
        );
        expect((await pool.getPoolType())).to.equal(_poolType["treasury"]);
        expect((await pool.getGoalAmount(ethers.constants.AddressZero))).to.equal("0");

        // any address can distribute

        // deposit some funds
        await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1.56822").toString()})

        expect(
            (await pool.getTotalDistAmount(ethers.constants.AddressZero))
        ).to.equal(ethers.utils.parseEther("1.56822").toString())

        // distribute from external address should work  
        await pool.connect(accounts[12])
            .functions.distribute(poolUsers, ethers.constants.AddressZero)

        // validate distribution
        let expectedDistribution = await simulateDistribution(
            pool, ethers.utils.parseEther("1.56822"), poolUsers, poolShares);

        for (let i = 0; i < poolUsers.length; i++){
            let assignedDist = await pool.connect(accounts[10])
                .functions.getUserAmounts(poolUsers[i], ethers.constants.AddressZero)
            console.log(
                "addr", poolUsers[i], 
                "distributed ammount", assignedDist.toString(), 
                "expected", expectedDistribution[i].toString());
            expect(assignedDist.toString()).to.equal(expectedDistribution[i].toString());
        }

        // check that tokens can be transferred
        // try to transfer 100 wei to account 11 should work
        let participationTokenAddress = await pool.getParticipationToken();
        console.log("participationToken", participationTokenAddress);
        let participationToken = await ethers.getContractAt(
            "ParticipationToken", participationTokenAddress);
        expect(
            (await participationToken.balanceOf(accounts[11].address)).toString()
        ).to.equal("0")
        await participationToken.connect(poolOwner)
                .transfer(accounts[11].address, "100") 
        expect(
            (await participationToken.balanceOf(accounts[11].address)).toString()
        ).to.equal("100")

    })
})