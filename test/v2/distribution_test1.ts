import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, Signer } from "ethers"
import {expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployStorage, deployPoolLogic, deployPoolMaster, deployParticipationPool, deployTreasuryTypePool} from "../utils/deploys";
import { getNextDistributionDate } from "../utils/pools";


describe("test distribution dates when doing pool distributions", function () {
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
        poolOwner = accounts[2];
        poolUsers = [accounts[2].address, accounts[3].address, accounts[4].address];
        poolShares = [86, 59, 54];
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
    it("test change in nextDistribution after make a distribution", async function () {

        pool = await deployTreasuryTypePool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, firstDistributionDate, 999,
            distributionInterval
        );
        let expectedNextDistDate = -1;
        for (let i = 0; i < 999; i++){
            if (Math.floor(Date.now() / 1000) < firstDistributionDate + distributionInterval * i){
                expectedNextDistDate = firstDistributionDate + distributionInterval * i;
                break;
            }
        }
        // const expectedNextDistDate = firstDistributionDate + distributionInterval * 6;

        let nextDist = await getNextDistributionDate(pool, ethers.constants.AddressZero, accounts[10]);
        // check that before make distribution, nextDist is firstDistributionDate on contract
        expect(nextDist).to.equal(firstDistributionDate);
        // deposit funds to make a distribution
        console.log("--> deposit some funds...")
        let txData = await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})
        // do a manual distribution
        console.log("--> do a distribution")
        txData = await pool.connect(operational)
            .functions.distribute(poolUsers, ethers.constants.AddressZero);
        // consult nextDist again. this time should match the expectedNextDistDate
        console.log("--> check the next distribution date")
        nextDist = await getNextDistributionDate(pool, ethers.constants.AddressZero, accounts[10]);
        var d = new Date(0);
        d.setUTCSeconds(nextDist)
        console.log("-->next distribution date for pool is:", nextDist, "date is", d);
        expect(nextDist).to.equal(expectedNextDistDate);
    })
    it ("try to distribute from a pool that is set to distribute in the future", async function () {
        firstDistributionDate = Math.floor(Date.now() / 1000) + distributionInterval * 5 + 567;
        pool = await deployTreasuryTypePool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, firstDistributionDate, 999,
            distributionInterval
        );
        let nextDist = await getNextDistributionDate(pool, ethers.constants.AddressZero, accounts[10]);
        // check that before make distribution, nextDist is firstDistributionDate on contract
        console.log("first distribution date is", firstDistributionDate);
        expect(nextDist).to.equal(firstDistributionDate);
        // deposit funds to make a distribution
        console.log("--> deposit some funds...")
        let txData = await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})
        // do a manual distribution
        console.log("--> try to do a distribution")
        await expect(
            pool.connect(operational)
                .functions.distribute(poolUsers, ethers.constants.AddressZero)
        ).to.be.rejectedWith("Cannot distribute in the current timestamp")
    })
    it ("try to deploy from a pool that recently have distributed", async function () {
        pool = await deployParticipationPool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, firstDistributionDate, 999,
            distributionInterval
        );

        // deposit funds to make a distribution
        console.log("--> deposit some funds...")
        let txData = await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})
        // do a manual distribution
        console.log("--> do a distribution")
        txData = await pool.connect(poolOwner)
            .functions.distribute(poolUsers, ethers.constants.AddressZero);
        // deposit funds to make a distribution
        console.log("--> deposit some funds again...")
        txData = await pool.connect(accounts[10])
            .functions.deposit({value: ethers.utils.parseEther("1").toString()})
        console.log("--> try to do another manual distribution")
        await expect(
            pool.connect(poolOwner)
                .functions.distribute(poolUsers, ethers.constants.AddressZero)
        ).to.be.rejectedWith("Cannot distribute in the current timestamp");
    })
})