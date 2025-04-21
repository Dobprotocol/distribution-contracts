import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract, Signer, BigNumber } from "ethers"
import {expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { 
    deployStorage, 
    deployPoolLogic, 
    deployPoolMaster, 
    deployParticipationPool, 
    deployExternalToken,
    deployTokenSaleMarket,
    deployTreasuryPool
} from "../utils/deploys";
import { getNextDistributionDate, simulateDistribution, getSigner} from "../utils/pools";
import { getGas, findEvent, getBalances } from "../utils/transaction";

describe("validate token sale market", function (){
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
    let treasuryPool: Contract;
    let tsm: Contract;
    let _tsm: Contract;
    let _proxy: Contract;
    let token: Contract;
    let dobToken: Contract;

    beforeEach(async function() {
        /**
         * before each test do:
         * 1.- deploy storage
         * 2.- deploy pool master
         * 3.- deploy treasury
         * 4.- deploy token sale market
         * 5.- deploy a test participation token and participation pool
         * 6.- define an allowance from user to token sale maker
         */

        accounts = await ethers.getSigners();
        creator = accounts[0];
        operational = accounts[1];
        distributionInterval = 5000;
        firstDistributionDate = Math.floor(Date.now() / 1000) - distributionInterval * 10;

        console.log("::::: pre-test deploys ::::::")
        // console.log("1. deploy storage, pool master, and logic")
        _storage = await deployStorage(creator);
        [_pm, _pmc] = await deployPoolMaster(creator, _storage);
        _v1 = await deployPoolLogic(_storage, creator, "NoLimitDistributionPool");

        // console.log("2. initialize poolmaster")
        await _pmc.connect(creator)
            .functions.initialize(1, 1, 1, operational.address, 300);
        await _pm.connect(creator)
            .functions.initialize(_pmc.address);

        // console.log("3. add logic version 1")
        await _pmc.connect(creator)
            .functions.addLogicVersion(
                _v1.address, 1, "NoLimitDistributionPool"
            )
        // console.log(
        //     "->latest logic version:", 
        //     await _pm.connect(accounts[10]).functions.getLatestVersion())

        // console.log("4. create treasury pool")
        treasuryPool = await deployTreasuryPool(
            _pm, _pmc, operational, creator
        )

        // console.log("5. deploy token sale market ")
        let [__tsm, __proxy] = await deployTokenSaleMarket(creator, operational, _storage, 300);
        tsm = __tsm.attach(__proxy.address);
        _tsm = __tsm;
        _proxy = __proxy;

        // console.log("6. deploy test pool")
        poolOwner = accounts[2];
        poolUsers = [accounts[2].address, accounts[3].address];
        poolShares = [86, 14];
        console.log("deploy participation pool")
        pool = await deployParticipationPool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, firstDistributionDate, 999,
            distributionInterval
        );
        console.log("pool deployed")
        
        // console.log("7. set allowance")
        let tokenAddress = await pool.connect(poolOwner).functions.getParticipationToken();
        token = await ethers.getContractAt("ParticipationToken", tokenAddress[0]);
        for (let i=0;i<poolUsers.length;i++){
            let _acc = getSigner(poolUsers[i], accounts)
            if (_acc != undefined){
                await token.connect(_acc)
                    .functions.approve(_proxy.address, poolShares[i], [])
            }
        }
        tokenAddress = await treasuryPool.connect(operational).functions.getParticipationToken();
        dobToken = await ethers.getContractAt("ParticipationToken", tokenAddress[0]);
        await dobToken.connect(operational)
            .functions.approve(_proxy.address, 300, [])

        console.log("::::::::: pre-test done :::::::::")
    })
    it("put a token for sale and update properties should produce events", async function () {
        /**
         * this test does:
         * 1.- call setSaleProperties()
         * 2.- check resulting events
         * 3.- call again setSaleProperties()
         * 4.- check resulting events again
         */
        let _salePrice = ethers.utils.parseUnits("1", "ether");
        let _minDivision = 1
        let txData = await tsm.connect(getSigner(poolUsers[0], accounts))
            .functions.setSaleProperties(
                token.address,
                _salePrice,
                _minDivision
            )
        let resData = await txData.wait()
        let gasCostSetSale = getGas(txData, resData);
        let event = findEvent(resData, "SaleProperty");
        expect(event.args.seller).to.equal(poolUsers[0])
        expect(event.args.token).to.equal(token.address)
        expect(event.args.price.toString()).to.equal(_salePrice.toString())
        expect(event.args.unit.toString()).to.equal(_minDivision.toString())
        expect(event.args.applyCommission).to.be.true

        await tsm.connect(getSigner(poolUsers[0], accounts))
            .functions.getSaleProperties(token.address)
            .then((res) => {
                expect(res.salePrice.toString()).to.equal(_salePrice.toString())
                expect(res.minDivision).to.equal(_minDivision)
                expect(res.applyCommission).to.be.true;
                expect(res.lockStatus).to.be.false;
            })

        // set new sale properties
        _salePrice = ethers.utils.parseUnits("0.452", "ether");
        _minDivision = 2
        txData = await tsm.connect(getSigner(poolUsers[0], accounts))
            .functions.setSaleProperties(
                token.address,
                _salePrice,
                _minDivision
            )
        resData = await txData.wait()
        gasCostSetSale = getGas(txData, resData);
        event = findEvent(resData, "SaleProperty");
        expect(event.args.seller).to.equal(poolUsers[0])
        expect(event.args.token).to.equal(token.address)
        expect(event.args.price.toString()).to.equal(_salePrice.toString())
        expect(event.args.unit.toString()).to.equal(_minDivision.toString())
        expect(event.args.applyCommission).to.be.true

        await tsm.connect(getSigner(poolUsers[0], accounts))
            .functions.getSaleProperties(token.address)
            .then((res) => {
                expect(res.salePrice.toString()).to.equal(_salePrice.toString())
                expect(res.minDivision).to.equal(_minDivision)
                expect(res.applyCommission).to.be.true;
                expect(res.lockStatus).to.be.false;
            })
    })
    it("put a token for initial sale and update properties should produce events", async function () {
        /**
         * this test does:
         * 1.- call setInitialSaleProperties()
         * 2.- check resulting events
         * 3.- call again setInitialSaleProperties()
         * 4.- check resulting events again
         */
        let _salePrice = ethers.utils.parseUnits("1", "ether");
        let _minDivision = 1
        let txData = await tsm.connect(operational)
            .functions.setInitialSaleProperties(
                treasuryPool.address,
                _salePrice,
                _minDivision
            )
        let resData = await txData.wait()
        let gasCostSetSale = getGas(txData, resData);
        let event = findEvent(resData, "SaleProperty");
        expect(event.args.seller).to.equal(operational.address)
        expect(event.args.token).to.equal(dobToken.address)
        expect(event.args.price.toString()).to.equal(_salePrice.toString())
        expect(event.args.unit.toString()).to.equal(_minDivision.toString())
        expect(event.args.applyCommission).to.be.false

        await tsm.connect(operational)
            .functions.getSaleProperties(dobToken.address)
            .then((res) => {
                expect(res.salePrice.toString()).to.equal(_salePrice.toString())
                expect(res.minDivision).to.equal(_minDivision)
                expect(res.applyCommission).to.be.false;
                expect(res.lockStatus).to.be.false;
            })

        // set new sale properties
        _salePrice = ethers.utils.parseUnits("0.452", "ether");
        _minDivision = 3
        txData = await tsm.connect(operational)
            .functions.setInitialSaleProperties(
                treasuryPool.address,
                _salePrice,
                _minDivision
            )
        resData = await txData.wait()
        gasCostSetSale = getGas(txData, resData);
        event = findEvent(resData, "SaleProperty");
        expect(event.args.seller).to.equal(operational.address)
        expect(event.args.token).to.equal(dobToken.address)
        expect(event.args.price.toString()).to.equal(_salePrice.toString())
        expect(event.args.unit.toString()).to.equal(_minDivision.toString())
        expect(event.args.applyCommission).to.be.false

        await tsm.connect(operational)
            .functions.getSaleProperties(dobToken.address)
            .then((res) => {
                expect(res.salePrice.toString()).to.equal(_salePrice.toString())
                expect(res.minDivision).to.equal(_minDivision)
                expect(res.applyCommission).to.be.false;
                expect(res.lockStatus).to.be.false;
            })
    })
    it("put a token for sale and lock it should reject buy tries", async function () {
        /**
         * this test does:
         * 1.- call setSaleProperties()
         * 2.- call lockSale()
         * 3.- reject call to buyToken()
         */
        let _salePrice = ethers.utils.parseUnits("1", "ether");
        let _minDivision = 1
        let txData = await tsm.connect(getSigner(poolUsers[0], accounts))
            .functions.setSaleProperties(
                token.address,
                _salePrice,
                _minDivision
            )
        let resData = await txData.wait()
        let gasCostSetSale = getGas(txData, resData);

        await tsm.connect(getSigner(poolUsers[0], accounts))
            .functions.lockSale(token.address)


        await expect(
            tsm.connect(accounts[11])
                .functions.buyToken(
                    10000, 
                    poolUsers[0], 
                    token.address,
                    {value: ethers.utils.parseUnits("123", "ether").toString()})
        ).to.be.rejectedWith("SALE_IS_LOCKED");

    })
    it("put a token for initial sale and lock it, should reject buy tries", async function (){
        /**
         * this test does:
         * 1.- call setInitialSaleProperties()
         * 2.- call lockSale()
         * 3.- reject calls to buyToken()
         */
        let _salePrice = ethers.utils.parseUnits("1", "ether");
        let _minDivision = 2
        let txData = await tsm.connect(operational)
            .functions.setInitialSaleProperties(
                treasuryPool.address,
                _salePrice,
                _minDivision
            )
        let resData = await txData.wait()
        let gasCostSetSale = getGas(txData, resData);

        await tsm.connect(operational)
            .functions.lockSale(dobToken.address)

        // intentionally use wrong nTokensTobuy inpunts to validate that
        // first checks lock status
        await expect(
            tsm.connect(accounts[11])
                .functions.buyToken(
                    1000, 
                    operational.address, 
                    dobToken.address,
                    {value: ethers.utils.parseUnits("123", "ether").toString()})
        ).to.be.rejectedWith("SALE_IS_LOCKED");
    })

    it("put a token for sale, buy some amount should trigger transactions", async function() {
        /**
         * this test does:
         * 1.- call setSaleProperties()
         * 2.- call buyToken() with valid amounts
         * 3.- check transactions and events
         * 4.- check commission
         */
        let balances = await getBalances(accounts, [token], ["token"]);
        console.log("pool user 0", await token.balanceOf(poolUsers[0]))
        let _salePrice = ethers.utils.parseUnits("0.001", "ether");
        let _minDivision = 1
        let txData = await tsm.connect(getSigner(poolUsers[0], accounts))
            .functions.setSaleProperties(
                token.address,
                _salePrice,
                _minDivision
            )
        let resData = await txData.wait()
        let gasCostSetSale = getGas(txData, resData);
        balances[poolUsers[0]].eth = balances[poolUsers[0]].eth.sub(gasCostSetSale);
        // allowance was set for 74 tokens with minDivision of 1
        // buy 54 tokens at 0.001 ETH per token should be 0.054 ETH
        let tokenAmount = BigNumber.from("54")
        let ethAmount = ethers.utils.parseUnits("0.054", "ether")
        await tsm.functions
            .estimatePrice(
                token.address,
                poolUsers[0],
                tokenAmount.toString()
            )
            .then((res) => {
                expect(res.toString()).to.equal(ethAmount.toString())
            })

        txData = await tsm.connect(accounts[11])
            .functions.buyToken(
                tokenAmount.toString(), 
                poolUsers[0], 
                token.address,
                {value: ethAmount.toString()})
        resData = await txData.wait()
        gasCostSetSale = getGas(txData, resData);
        balances[accounts[11].address].eth = balances[accounts[11].address].eth.sub(gasCostSetSale)
        // validate the adquired tokens and the updated balances of each account
        balances[poolUsers[0]]["token"] = balances[poolUsers[0]]["token"].sub(tokenAmount)
        balances[accounts[11].address]["token"] = balances[accounts[11].address]["token"].add(tokenAmount)
        balances[accounts[11].address].eth = balances[accounts[11].address].eth.sub(ethAmount)
        let _commission = ethAmount.mul(BigNumber.from(300)).div(BigNumber.from(10000))
        let _diff = ethAmount.sub(_commission)
        balances[poolUsers[0]].eth = balances[poolUsers[0]].eth.add(_diff)
        balances[operational.address].eth = balances[operational.address].eth.add(_commission)

        let event = findEvent(resData, "BuyRecord");
        expect(event.args.seller).to.equal(poolUsers[0]);
        expect(event.args.buyer).to.equal(accounts[11].address);
        expect(event.args.token).to.equal(token.address)
        expect(event.args.amount.toString()).to.equal(tokenAmount.toString());
        expect(event.args.price.toString()).to.equal(_salePrice.toString());
        expect(event.args.spent.toString()).to.equal(ethAmount.toString());
        expect(event.args.commission.toString()).to.equal(_commission.toString());


        let balancesAfter = await getBalances(accounts, [token], ["token"])
        for (let i = 0; i < accounts.length; i++) {
            // console.log(
            //     i, balances[accounts[i].address].eth.toString(), 
            //     balancesAfter[accounts[i].address].eth.toString(),
            //     balances[accounts[i].address]["token"].toString(),
            //     balancesAfter[accounts[i].address]["token"].toString())
            expect(
                balances[accounts[i].address].eth.toString()
            ).to.equal(balancesAfter[accounts[i].address].eth.toString())

            expect(
                balances[accounts[i].address]["token"].toString()
            ).to.equal(balancesAfter[accounts[i].address]["token"].toString())
        }

    })
    it("put a token for initial sale, buy some amount should trigger transactions", async function() {
        /**
         * this test does:
         * 1.- call setInitialSaleProperties()
         * 2.- call buyToken() with valid amounts
         * 3.- check transactions and events
         * 4.- check that commission was 0
         */
        let balances = await getBalances(accounts, [dobToken], ["token"]);
        let _salePrice = ethers.utils.parseUnits("0.001", "ether");
        let _minDivision = 1
        let txData = await tsm.connect(operational)
            .functions.setInitialSaleProperties(
                treasuryPool.address,
                _salePrice,
                _minDivision
            )
        let resData = await txData.wait()
        let gasCostSetSale = getGas(txData, resData);
        balances[operational.address].eth = balances[operational.address].eth.sub(gasCostSetSale);
        // allowance was set for 74 tokens with minDivision of 1
        // buy 54 tokens at 0.001 ETH per token should be 5.4 ETH
        let tokenAmount = BigNumber.from("54")
        let ethAmount = ethers.utils.parseUnits("0.054", "ether")
        console.log("estimate price")
        await tsm.functions
            .estimatePrice(
                dobToken.address,
                operational.address,
                tokenAmount.toString()
            )
            .then((res) => {
                expect(res.toString()).to.equal(ethAmount.toString())
            })
        console.log("execute buyToken")
        txData = await tsm.connect(accounts[11])
            .functions.buyToken(
                tokenAmount.toString(), 
                operational.address, 
                dobToken.address,
                {value: ethAmount.toString()})
        resData = await txData.wait()
        console.log("get gas")
        gasCostSetSale = getGas(txData, resData);
        balances[accounts[11].address].eth = balances[accounts[11].address].eth.sub(gasCostSetSale)
        // validate the adquired tokens and the updated balances of each account
        balances[operational.address]["token"] = balances[operational.address]["token"].sub(tokenAmount)
        balances[accounts[11].address]["token"] = balances[accounts[11].address]["token"].add(tokenAmount)
        balances[accounts[11].address].eth = balances[accounts[11].address].eth.sub(ethAmount)
        balances[operational.address].eth = balances[operational.address].eth.add(ethAmount)
        console.log("find event")
        let event = findEvent(resData, "BuyRecord");
        expect(event.args.seller).to.equal(operational.address);
        expect(event.args.buyer).to.equal(accounts[11].address);
        expect(event.args.token).to.equal(dobToken.address)
        expect(event.args.amount.toString()).to.equal(tokenAmount.toString());
        expect(event.args.price.toString()).to.equal(_salePrice.toString());
        expect(event.args.spent.toString()).to.equal(ethAmount.toString());
        expect(event.args.commission.toString()).to.equal("0");


        let balancesAfter = await getBalances(accounts, [dobToken], ["token"])
        for (let i = 0; i < accounts.length; i++) {
            // console.log(
            //     i, balances[accounts[i].address].eth.toString(), 
            //     balancesAfter[accounts[i].address].eth.toString(),
            //     balances[accounts[i].address]["token"].toString(),
            //     balancesAfter[accounts[i].address]["token"].toString())
            expect(
                balances[accounts[i].address].eth.toString()
            ).to.equal(balancesAfter[accounts[i].address].eth.toString())

            expect(
                balances[accounts[i].address]["token"].toString()
            ).to.equal(balancesAfter[accounts[i].address]["token"].toString())
        }
    })
    it(
    "put a token for initial sale and sell it to many different users should trigger transactions", 
    async function() {
        /**
         * this test does:
         * 1.- call setInitialSaleProperties()
         * 2.- call buyToken() from different users with different amounts
         * 3.- validate all transactions and events
         * 4.- check that commission was always 0
         */
        let balances = await getBalances(accounts, [dobToken], ["token"]);
        let _salePrice = ethers.utils.parseUnits("0.001", "ether");
        let _minDivision = 1
        let txData = await tsm.connect(operational)
            .functions.setInitialSaleProperties(
                treasuryPool.address,
                _salePrice,
                _minDivision
            )
        let resData = await txData.wait()
        let gasCostSetSale = getGas(txData, resData);
        balances[operational.address].eth = balances[operational.address].eth.sub(gasCostSetSale);
        // allowance was set for 300 for initial dob token sale
        // configure many buys
        let buyAccounts = [accounts[11], accounts[15], accounts[9], accounts[8], accounts[13]]
        let buyAmounts = [
            BigNumber.from("54"),
            BigNumber.from("1"),
            BigNumber.from("99"),
            BigNumber.from("12"),
            BigNumber.from("19")
        ]
        for (let k = 0; k < buyAccounts.length; k++){
            let ethAmount = buyAmounts[k].mul(_salePrice).div(BigNumber.from("1"))
            await tsm.functions
                .estimatePrice(
                    dobToken.address,
                    operational.address,
                    buyAmounts[k].toString()
                )
                .then((res) => {
                    expect(res.toString()).to.equal(ethAmount.toString())
                })
            txData = await tsm.connect(buyAccounts[k])
                .functions.buyToken(
                    buyAmounts[k].toString(), 
                    operational.address, 
                    dobToken.address,
                    {value: ethAmount.toString()})
            resData = await txData.wait()
            gasCostSetSale = getGas(txData, resData);
            balances[buyAccounts[k].address].eth = balances[buyAccounts[k].address].eth.sub(gasCostSetSale)
            // validate the adquired tokens and the updated balances of each account
            balances[operational.address]["token"] = balances[operational.address]["token"].sub(buyAmounts[k])
            balances[buyAccounts[k].address]["token"] = balances[buyAccounts[k].address]["token"].add(buyAmounts[k])
            balances[buyAccounts[k].address].eth = balances[buyAccounts[k].address].eth.sub(ethAmount)
            balances[operational.address].eth = balances[operational.address].eth.add(ethAmount)

            let event = findEvent(resData, "BuyRecord");
            expect(event.args.seller).to.equal(operational.address);
            expect(event.args.buyer).to.equal(buyAccounts[k].address);
            expect(event.args.token).to.equal(dobToken.address)
            expect(event.args.amount.toString()).to.equal(buyAmounts[k].toString());
            expect(event.args.price.toString()).to.equal(_salePrice.toString());
            expect(event.args.spent.toString()).to.equal(ethAmount.toString());
            expect(event.args.commission.toString()).to.equal("0");
        }

        let balancesAfter = await getBalances(accounts, [dobToken], ["token"])
        for (let i = 0; i < accounts.length; i++) {
            // console.log(
            //     i, balances[accounts[i].address].eth.toString(), 
            //     balancesAfter[accounts[i].address].eth.toString(),
            //     balances[accounts[i].address]["token"].toString(),
            //     balancesAfter[accounts[i].address]["token"].toString())
            expect(
                balances[accounts[i].address].eth.toString()
            ).to.equal(balancesAfter[accounts[i].address].eth.toString())

            expect(
                balances[accounts[i].address]["token"].toString()
            ).to.equal(balancesAfter[accounts[i].address]["token"].toString())
        }
    })
})