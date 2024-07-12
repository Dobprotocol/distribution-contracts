import { ethers, network } from "hardhat";
import { expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployExternalToken, deployLockedStaking } from "../utils/deploys";
import { Contract, Signer, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

interface StakingConfig {
    dprOver10kk: number
    tokensForRewards: string
    lockPeriodDuration: number
    depositPeriodDuration: number
    startDate: number
}

function revertMsg(msg){
    return "VM Exception while processing transaction: reverted " +
    `with reason string '${msg}'`
}

describe("TEST setConfig() function interactions", function () {
    let accounts: SignerWithAddress[];
    let _owner: Signer;
    let _staking: Contract;
    let _token: Contract;
    let _oneDay: number;
    let _APR: number;
    let _DPR: number;
    let _zero: BigNumber;
    let _stakingConfig1: StakingConfig;
    beforeEach(async function () {
        accounts = await ethers.getSigners();
        _owner = accounts[0];
        _token = await deployExternalToken(
            _owner,
            "testStaking",
            "TST",
            ethers.utils.parseEther("1000").toString()
        )
        _staking = await deployLockedStaking(
            _owner,
            _token.address,
            _token.address
        )

        await _token.connect(_owner).functions
            .transfer(
                _staking.address,
                ethers.utils.parseEther("100").toString()
            )
        let block = await ethers.provider.getBlock("latest");
        _oneDay = 86400;
        _APR = 0.1; // 10%
        _DPR = Math.floor(10000000 * _APR / 365);
        console.log(
            "original APR", _APR,
            "equivalente DPROVER10KK", _DPR,
            "calculated APR", _DPR * 365 / 10000000);
        _zero = BigNumber.from(0)
        _stakingConfig1 = {
            dprOver10kk: _DPR,
            tokensForRewards: ethers.utils.parseEther("10").toString(),
            lockPeriodDuration: _oneDay * 10, // 10 days
            depositPeriodDuration: _oneDay, // 1 day
            startDate: block.timestamp + _oneDay // tomorrow
        }
    })

    it("set configuration and related getters", async function () {
        // validate getters before setting a new config
        const [stakingKey] = await _staking.functions.getConfigKey(_stakingConfig1);
        console.log("staking key is:", stakingKey)
        // we have to assume that the stakingKey is correct, latter we will test
        // this.

        // config should be "empty" before set
        await _staking.functions.getStakingConfig(stakingKey)
            .then((res) => {
                expect(res[0].dprOver10kk).to.equal(_zero);
                expect(res[0].tokensForRewards).to.equal(_zero);
                expect(res[0].lockPeriodDuration).to.equal(_zero);
                expect(res[0].depositPeriodDuration).to.equal(_zero);
                expect(res[0].startDate).to.equal(_zero)
            })

        // locked tokens should be zero before
        await _staking.functions.getTotalLockedTokens()
            .then((res) => {
                expect(res[0]).to.equal(_zero);
            })

        // state should be notSet (5)
        await _staking.functions.getConfigState(stakingKey)
            .then((res) => {
                expect(res[0]).to.equal(5);
            })

        // set the staking config
        await _staking.connect(_owner)
            .functions.setStakingConfig(_stakingConfig1)

        // verify with getters functions
        // check that the correct config was saved
        await _staking.functions.getStakingConfig(stakingKey)
            .then((res) => {
                expect(res[0].dprOver10kk).to.equal(
                    BigNumber.from(_stakingConfig1.dprOver10kk));
                expect(res[0].tokensForRewards).to.equal(
                    BigNumber.from(_stakingConfig1.tokensForRewards));
                expect(res[0].lockPeriodDuration).to.equal(
                    BigNumber.from(_stakingConfig1.lockPeriodDuration));
                expect(res[0].depositPeriodDuration).to.equal(
                    BigNumber.from(_stakingConfig1.depositPeriodDuration));
                expect(res[0].startDate).to.equal(
                    BigNumber.from(_stakingConfig1.startDate));
            })

        // check that locked tokens was updated
        await _staking.functions.getTotalLockedTokens()
            .then((res) => {
                expect(res[0]).to.equal(
                    BigNumber.from(_stakingConfig1.tokensForRewards));
            })

        // state should be PreOpened (0)
        await _staking.functions.getConfigState(stakingKey)
            .then((res) => {
                expect(res[0]).to.equal(0);
            })
    })

    it("[BorderCase] set a duplicated config", async function () {
        // set the staking config
        await _staking.connect(_owner)
            .functions.setStakingConfig(_stakingConfig1)

        await expect(
            // set the same staking config
            _staking.connect(_owner)
                .functions.setStakingConfig(_stakingConfig1)
        ).to.be.rejectedWith(
            revertMsg("config already exists, cannot set")
        )
    })

    it(
    "[BorderCase] setStakingConfig for lockPeriodDuration < 7days", 
    async function (){
        // lockPeriodDuration must be at least 1 week
        let tmp: StakingConfig = JSON.parse(JSON.stringify(_stakingConfig1));
        tmp.lockPeriodDuration = _oneDay * 3 // 3 days < 1 week
        await expect(
            _staking.connect(_owner)
                .functions.setStakingConfig(tmp)
        ).to.be.rejectedWith(
            revertMsg("lockPeriodDuration must be at least 1 week")
        )
    })
    it(
    "[BorderCase] setStakingConfig for depositPeriodDuration < 1day", 
    async function(){
        let tmp: StakingConfig = JSON.parse(JSON.stringify(_stakingConfig1));
        tmp.depositPeriodDuration = _oneDay - 60 // 23:59 < 1day
        await expect(
            _staking.connect(_owner)
                .functions.setStakingConfig(tmp)
        ).to.be.rejectedWith(
            revertMsg("depositPeriodDuration must be at least 1 day")
        )
    })
    it(
    "[BorderCase] setStakingConfig for lockPeriodDuration not divisible by 1day",
    async function(){
        let tmp: StakingConfig = JSON.parse(JSON.stringify(_stakingConfig1));
        tmp.lockPeriodDuration = _oneDay * 7 + 60 // 7day+60sec % 1day = 60 != 0
        await expect(
            _staking.connect(_owner)
                .functions.setStakingConfig(tmp)
        ).to.be.rejectedWith(
            revertMsg("LockPeriodDuration must be divisible by 86400")
        )
    })
    it(
    "[BorderCase] setStakingConfig for depositPeriodDuration not divisible by 1day", 
    async function(){
        let tmp: StakingConfig = JSON.parse(JSON.stringify(_stakingConfig1));
        tmp.depositPeriodDuration = _oneDay + 60 //1day+60sec % 1day = 60 != 0
        await expect(
            _staking.connect(_owner)
                .functions.setStakingConfig(tmp)
        ).to.be.rejectedWith(
            revertMsg("depositPeriodDuration must be divisible by 86400")
        )
    })
    it(
        "[BorderCase] set a config when contract has not enough reward tokens to lock", 
        async function(){
            let tmp: StakingConfig = JSON.parse(JSON.stringify(_stakingConfig1));
            tmp.tokensForRewards = ethers.utils.parseEther("1000").add(BigNumber.from(1)).toString()

            tmp.tokensForRewards
            await expect(
                _staking.connect(_owner)
                    .functions.setStakingConfig(tmp)
            ).to.be.rejectedWith(
                revertMsg("not enough tokens in contract")
            )
        }
    )
})