import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, Signer } from "ethers"
import {expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployStorage, deployPoolLogic, deployPoolMaster, deployParticipationPool, deployExternalToken, deployTreasuryTypePool} from "../utils/deploys";
import { getNextDistributionDate, simulateDistribution } from "../utils/pools";

describe("test multiple distributions of the same pool", function () {
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

    async function findNextDist(currTime){
        let expectedNextDistDate = -1;
        for (let i = 0; i < 999; i++){
            if (currTime < firstDistributionDate + distributionInterval * i){
                expectedNextDistDate = firstDistributionDate + distributionInterval * i;
                // console.log("----> current date is",  currTime)
                // console.log("----==> matches dist interval number", i);
                // console.log("----==> with next dist date", expectedNextDistDate);
                break;
            }
        }
        return expectedNextDistDate;
    }

    async function nextDistFromBlockTimeStamp(resData){
        let event;
        for (let _e of resData["events"]){
            if (_e["event"] == "updateDistributionDate"){
                event = _e;
                break;
            }
        }
        if (event != null){
            // console.log("event", event);
            let _block = await ethers.provider.getBlock(event["blockNumber"]);
            // console.log("block time stamp", _block.timestamp);
            return await findNextDist(_block.timestamp);
        } else {
            throw "event updateDistributionDate not found!!"; 
        }
    }

    beforeEach(async function() {
        accounts = await ethers.getSigners();
        creator = accounts[0];
        operational = accounts[1];
        distributionInterval = 5;
        firstDistributionDate = Math.floor(Date.now() / 1000) - distributionInterval * 10;

        console.log("::::: pre-test deploys ::::::")
        console.log("1. deploy storage, pool master, and logic")
        _storage = await deployStorage(creator);
        [_pm, _pmc] = await deployPoolMaster(creator, _storage);
        _v1 = await deployPoolLogic(_storage, creator, "NoLimitDistributionPool");

        console.log("2. initialize poolmaster")
        await _pmc.connect(creator)
            .functions.initialize(1, 1, 1, operational.address, 300);
        await _pm.connect(creator)
            .functions.initialize(_pmc.address);
        console.log("3. add logic version 1")
        await _pmc.connect(creator)
            .functions.addLogicVersion(
                _v1.address, 1, "NoLimitDistributionPool"
            )
        console.log(
            "->latest logic version:", 
            await _pmc.connect(accounts[10]).functions.getLatestVersion())

        console.log("4. create treasury pool")
        await _pm.connect(creator)
            .functions.createPoolMasterTreasuryPool([operational.address], [100], '');

        console.log("::::::::: pre-test done :::::::::")
    })
    it ("test N consecutive distributions for currency ", async function () {
        const N = 5;
        console.log("===== Testing ", N, "successive distributions ======");
        console.log("distribution interval is", distributionInterval, "seconds");
        this.timeout(distributionInterval * 1000 * N) // all tests in this suite get 30 seconds before timeout
        poolOwner = accounts[2];
        poolUsers = [accounts[2].address, accounts[3].address];
        poolShares = [86, 14];

        pool = await deployTreasuryTypePool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, firstDistributionDate, 999,
            distributionInterval
        );

        let sumAmount = ethers.utils.parseEther("0");
        for (let i=0;i<N;i++){
            let prefix = "--> " + (i+1).toString() + "/" + N.toString();
            // deposit 1 eth/token
            let amount = ethers.utils.parseEther("1");
            sumAmount = sumAmount.add(amount);
            console.log(prefix, "deposit some funds...")
            let txData = await pool.connect(accounts[10])
                .functions.deposit({value: amount.toString()})
            // do distribution
            console.log(prefix, "do a distribution")
            txData = await pool.connect(operational)
                .functions.distribute(poolUsers, ethers.constants.AddressZero);

            let resData = await txData.wait();
            // find next dist date
            let expectedNextDist = await nextDistFromBlockTimeStamp(resData);
            let nextDist = await getNextDistributionDate(pool, ethers.constants.AddressZero, poolOwner);
            // check match of next distribution dates
            expect(nextDist).to.equal(expectedNextDist);

            if (i < N-1){
                // wait distribution interval
                console.log(prefix, "wait ", distributionInterval, "seconds")
                await new Promise(r => setTimeout(r, distributionInterval * 1000))
            }
        }
        console.log("==== check match of distributed amounts ==== ")
        console.log("---> total distributed amount", ethers.utils.formatEther(sumAmount));
        let expectedDistribution = await simulateDistribution(pool, sumAmount, poolUsers, poolShares, 3);
        for (let i = 0; i < poolUsers.length; i++){
            let assignedDist = await pool.connect(accounts[10])
                .functions.getUserAmounts(poolUsers[i], ethers.constants.AddressZero)
            console.log(
                "addr", poolUsers[i], 
                "distributed ammount", ethers.utils.formatEther(assignedDist.toString()), 
                "expected", ethers.utils.formatEther(expectedDistribution[i].toString()));
            expect(assignedDist.toString()).to.equal(expectedDistribution[i].toString());
        }
    })

    it ("test N consecutive distributions for external token ", async function () {
        const N = 5;
        console.log("===== Testing ", N, "successive distributions ======");
        console.log("distribution interval is", distributionInterval, "seconds");
        this.timeout(distributionInterval * 1000 * N) // all tests in this suite get 30 seconds before timeout
        poolOwner = accounts[2];
        poolUsers = [accounts[2].address, accounts[3].address];
        poolShares = [86, 14];

        let extToken = await deployExternalToken(
            accounts[11], "testToken", "TTD", ethers.utils.parseEther("100").toString())

        pool = await deployTreasuryTypePool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, firstDistributionDate, 999,
            distributionInterval
        );

        await pool.connect(poolOwner)
            .functions.addExternalToken(extToken.address)

        let sumAmount = ethers.utils.parseEther("0");
        for (let i=0;i<N;i++){
            let prefix = "--> " + (i+1).toString() + "/" + N.toString();
            // deposit 1 eth/token
            let amount = ethers.utils.parseEther("0.1");
            sumAmount = sumAmount.add(amount);
            console.log(prefix, "deposit some funds...")
            let txData = await extToken.connect(accounts[11])
                .functions.transfer(pool.address, amount.toString())
            // do distribution
            console.log(prefix, "do a distribution")
            txData = await pool.connect(operational)
                .functions.distribute(poolUsers, extToken.address);

            let resData = await txData.wait();
            // find next dist date
            let expectedNextDist = await nextDistFromBlockTimeStamp(resData);
            let nextDist = await getNextDistributionDate(pool, extToken.address, poolOwner);
            // check match of next distribution dates
            expect(nextDist).to.equal(expectedNextDist);

            if (i < N-1){
                // wait distribution interval
                console.log(prefix, "wait ", distributionInterval, "seconds")
                await new Promise(r => setTimeout(r, distributionInterval * 1000))
            }
        }
        console.log("==== check match of distributed amounts ==== ")
        console.log("---> total distributed amount", ethers.utils.formatEther(sumAmount));
        let expectedDistribution = await simulateDistribution(pool, sumAmount, poolUsers, poolShares, 3);
        for (let i = 0; i < poolUsers.length; i++){
            let assignedDist = await pool.connect(accounts[10])
                .functions.getUserAmounts(poolUsers[i], extToken.address)
            console.log(
                "addr", poolUsers[i], 
                "distributed ammount", ethers.utils.formatEther(assignedDist.toString()), 
                "expected", ethers.utils.formatEther(expectedDistribution[i].toString()));
            expect(assignedDist.toString()).to.equal(expectedDistribution[i].toString());
        }
    })
})