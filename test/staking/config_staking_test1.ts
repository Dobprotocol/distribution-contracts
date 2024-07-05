import { ethers } from "hardhat";
import { expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployExternalToken, deployLockedStaking } from "../utils/deploys";
import { Contract, Signer, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("", function () {
    let accounts: SignerWithAddress[];
    let _owner: Signer;
    let _staking: Contract;
    let _token: Contract;
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
    })

    it("test set configuration and related getters", async function () {
        const todayEpoch = Math.floor(Date.now() / 1000);
        const oneDay = 86400;
        const APR = 0.1; // 10%
        const DPR = Math.floor(10000000 * APR / 365);
        const zero = BigNumber.from(0)
        console.log(
            "original APR", APR, 
            "equivalente DPROVER10KK", DPR, 
            "calculated APR", DPR * 365 / 10000000);
        const stakingConfig = {
            dprOver10kk: DPR,
            tokensForRewards: ethers.utils.parseEther("10").toString(),
            lockPeriodDuration: oneDay * 10, // 10 days
            depositPeriodDuration: oneDay, // 1 day
            startDate: todayEpoch + oneDay // tomorrow
        }
        // validate getters before setting a new config
        const [stakingKey] = await _staking.functions.getConfigKey(stakingConfig);
        console.log("staking key is:", stakingKey) 
        // we have to assume that the stakingKey is correct, latter we will test
        // this.

        // config should be "empty" before set
        await _staking.functions.getStakingConfig(stakingKey)
            .then((res) => {
                expect(res[0].dprOver10kk).to.equal(zero);
                expect(res[0].tokensForRewards).to.equal(zero);
                expect(res[0].lockPeriodDuration).to.equal(zero);
                expect(res[0].depositPeriodDuration).to.equal(zero);
                expect(res[0].startDate).to.equal(zero)
            })

        // locked tokens should be zero before
        await _staking.functions.getTotalLockedTokens()
            .then((res) => {
                expect(res[0]).to.equal(zero);
            })

        // state should be notSet (5)
        await _staking.functions.getConfigState(stakingKey)
            .then((res) => {
                expect(res[0]).to.equal(5);
            })

        // set the staking config
        await _staking.connect(_owner)
            .functions.setStakingConfig(stakingConfig)
        
        // verify with getters functions
        // check that the correct config was saved
        await _staking.functions.getStakingConfig(stakingKey)
            .then((res) => {
                expect(res[0].dprOver10kk).to.equal(BigNumber.from(stakingConfig.dprOver10kk));
                expect(res[0].tokensForRewards).to.equal(BigNumber.from(stakingConfig.tokensForRewards));
                expect(res[0].lockPeriodDuration).to.equal(BigNumber.from(stakingConfig.lockPeriodDuration));
                expect(res[0].depositPeriodDuration).to.equal(BigNumber.from(stakingConfig.depositPeriodDuration));
                expect(res[0].startDate).to.equal(BigNumber.from(stakingConfig.startDate));
            })

        // check that locked tokens was updated
        await _staking.functions.getTotalLockedTokens()
            .then((res) => {
                expect(res[0]).to.equal(BigNumber.from(stakingConfig.tokensForRewards));
            })

        // state should be PreOpened (0)
        await _staking.functions.getConfigState(stakingKey)
            .then((res) => {
                expect(res[0]).to.equal(0);
            })
    })
})