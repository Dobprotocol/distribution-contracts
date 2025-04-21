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
import { randomBytes } from "crypto";

describe("evaluate limit cases for token sale market", function (){
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
         * 6.- define a base allowance from user to token sale maker
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
        let [__tsm, __proxy] = await deployTokenSaleMarket(creator, operational, _storage, 3);
        tsm = __tsm.attach(__proxy.address);
        _tsm = __tsm;
        _proxy = __proxy;

        // console.log("6. deploy test pool")
        poolOwner = accounts[2];
        poolUsers = [accounts[2].address, accounts[3].address];
        poolShares = [86, 14];
        pool = await deployParticipationPool(
            _pm, _pmc, poolOwner, poolUsers, poolShares, firstDistributionDate, 999,
            distributionInterval
        );
        
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
    it("configure a sale property for an invalid token should revert", async function () {
        /**
         * this test does:
         * 1.- call setSaleProperties() with wrong token address
         * 2.- check that call was rejected
         */
        let _salePrice = ethers.utils.parseUnits("1", "ether");
        let _minDivision = 100
        let _randomPKey = randomBytes(32).toString('hex');
        let _randomWallet = new ethers.Wallet(_randomPKey);
        console.log("random wallet", _randomWallet.address);
        await expect(
            tsm.connect(accounts[9])
                .functions.setSaleProperties(
                    _randomWallet.address,
                    _salePrice,
                    _minDivision
                )
        ).to.be.rejectedWith("ADDRESS_IS_NOT_CONTRACT");

        await expect(
            tsm.connect(accounts[9])
                .functions.setSaleProperties(
                    _pm.address,
                    _salePrice,
                    _minDivision
                )
        ).to.be.rejectedWith("Transaction reverted: function selector was not recognized and there's no fallback function");

    })
    it("configure an initial sale property for an invalid token should revert", async function () {
        /**
         * this test does:
         * 1.- call setInitialSaleProperties() with wrong token address
         * 2.- check that call was rejected
         */
        let _salePrice = ethers.utils.parseUnits("1", "ether");
        let _minDivision = 100
        let _randomPKey = randomBytes(32).toString('hex');
        let _randomWallet = new ethers.Wallet(_randomPKey);
        console.log("random wallet", _randomWallet.address);
        await expect(
            tsm.connect(accounts[9])
                .functions.setInitialSaleProperties(
                    _randomWallet.address,
                    _salePrice,
                    _minDivision
                )
        ).to.be.rejectedWith("Transaction reverted: function returned an unexpected amount of data");

        await expect(
            tsm.connect(accounts[9])
                .functions.setInitialSaleProperties(
                    _pm.address,
                    _salePrice,
                    _minDivision
                )
        ).to.be.rejectedWith("Transaction reverted: function selector was not recognized and there's no fallback function");
    })
    it("buy token for an amount bigger than the accepted allowance should reject", async function () { 
        /**
         * this test does:
         * 1.- define a smaller allowance (allowance < balance)
         * 2.- call setSaleProperties()
         * 3.- call buyToken() with amount higher than allowance
         */
        await token.connect(getSigner(poolUsers[0], accounts))
            .functions.approve(_proxy.address, 40, [])
        let _salePrice = ethers.utils.parseUnits("0.001", "ether");
        let _minDivision = 1
        let txData = await tsm.connect(getSigner(poolUsers[0], accounts))
            .functions.setSaleProperties(
                token.address,
                _salePrice,
                _minDivision
            )
        let tokenAmount = BigNumber.from(50)
        let ethAmount = tokenAmount.mul(_salePrice).div(BigNumber.from(1))
        await expect(
            tsm.connect(accounts[11])
                .functions.buyToken(
                    tokenAmount.toString(), 
                    poolUsers[0], 
                    token.address,
                    {value: ethAmount.toString()})
        ).to.be.rejectedWith("token allowance not available")
    })
    it("buy token for an amount bigger than the account balance should reject", async function () { 
        /**
         * this test does:
         * 1.- define bigger allowance (allowance > balance)
         * 2.- call setSaleProperties()
         * 3.- call buyToken() with amount higher than seller balance
         */
        console.log("seller balance:", await token.balanceOf(poolUsers[1]));
        await token.connect(getSigner(poolUsers[1], accounts))
            .functions.approve(_proxy.address, 1000, [])
        let _salePrice = ethers.utils.parseUnits("0.001", "ether");
        let _minDivision = 1
        let txData = await tsm.connect(getSigner(poolUsers[1], accounts))
            .functions.setSaleProperties(
                token.address,
                _salePrice,
                _minDivision
            )
        let tokenAmount = (await token.balanceOf(poolUsers[1])).add(_minDivision);
        let ethAmount = tokenAmount.mul(_salePrice).div(BigNumber.from(1))
        console.log("test rejection")
        await expect(
            tsm.connect(accounts[11])
                .functions.buyToken(
                    tokenAmount.toString(), 
                    poolUsers[1], 
                    token.address,
                    {value: ethAmount.toString()})
        ).to.be.rejectedWith("token amount not available")
    })
    it("pay more or less than expected amount for a buyToken should revert", async function () {
        /**
         * this test does:
         * 1.- call setSaleProperties()
         * 2.- try to buy token by paying less than expected amount
         * 3.- try to buy token by paying more than expected amount
         */
        let _salePrice = ethers.utils.parseUnits("0.001", "ether");
        let _minDivision = 1
        let txData = await tsm.connect(getSigner(poolUsers[0], accounts))
            .functions.setSaleProperties(
                token.address,
                _salePrice,
                _minDivision
            )
        let tokenAmount = BigNumber.from(50)
        let ethAmount = tokenAmount.mul(_salePrice).add(_salePrice)
        await expect(
            tsm.connect(accounts[11])
                .functions.buyToken(
                    tokenAmount.toString(), 
                    poolUsers[0], 
                    token.address,
                    {value: ethAmount.toString()})
        ).to.be.rejectedWith("ether paid doesnt match expected amount")

        ethAmount = tokenAmount.mul(_salePrice).sub(_salePrice)
        await expect(
            tsm.connect(accounts[11])
                .functions.buyToken(
                    tokenAmount.toString(), 
                    poolUsers[0], 
                    token.address,
                    {value: ethAmount.toString()})
        ).to.be.rejectedWith("ether paid doesnt match expected amount")
    })
    it("buy token by an amount that is not multiple of minDivision should revert", async function() {
        /**
         * this test does:
         * 1.- call setSaleProperties() with a minDivision of 100
         * 2.- try to buy 101 tokens should fail
         * 3.- try to buy 610 tokens should fail
         * 4.- try to buy 1 token should fail
         * 5.- try to buy 99 tokens should fail
         * 6.- try to buy 100 tokens should PASS
         * 7.- try to buy 9900 tokens should PASS
         */
        let _salePrice = ethers.utils.parseUnits("0.001", "ether");
        let _minDivision = 5
        let txData = await tsm.connect(getSigner(poolUsers[0], accounts))
            .functions.setSaleProperties(
                token.address,
                _salePrice,
                _minDivision
            )
        let nTokens = [11, 61, 1, 9]
        for (let _amount of nTokens){
            let tokenAmount = BigNumber.from(_amount)
            let ethAmount = tokenAmount.mul(_salePrice).div(BigNumber.from(_minDivision))
            await expect(
                tsm.connect(accounts[11])
                    .functions.buyToken(
                        tokenAmount.toString(), 
                        poolUsers[0], 
                        token.address,
                        {value: ethAmount.toString()})
            ).to.be.rejectedWith("nTokenToBuy is not divisible by the minimum division part")
        }
        nTokens = [10, 65]
        for (let _amount of nTokens){
            let tokenAmount = BigNumber.from(_amount)
            let ethAmount = tokenAmount.mul(_salePrice).div(BigNumber.from(_minDivision))
            await tsm.connect(accounts[11])
                    .functions.buyToken(
                        tokenAmount.toString(), 
                        poolUsers[0], 
                        token.address,
                        {value: ethAmount.toString()})
        }
    })
})