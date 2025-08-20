import { ethers, network } from "hardhat";
import { expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployExternalToken, deployLockedStaking } from "../utils/deploys";
import { Contract, Signer, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { 
    zero, 
    claimTokens, 
    checkUserStaked, 
    checkBalances, 
    revertMsg, 
    StakingConfig, 
    newConfig, 
    oneDay, 
    TestingData, 
    configureTest, 
    setStakingConfig, 
    stakeTokens,
    earlyWithdrawTokens,
    setConfigToOpen,
    skipFromLockedToCompleted,
    skipFromOpenToLocked
} from "./utils";

describe("TEST flushOldConfig() function interactions", function () {
    let accounts: SignerWithAddress[];
    let D: TestingData;
    let D2: TestingData;
    beforeEach(async function () {
        accounts = await ethers.getSigners();
        D = await configureTest(
            accounts,
            ethers.utils.parseEther("10000000"),
            ethers.utils.parseEther("100000")
        );
        D2 = await configureTest(
            accounts,
            ethers.utils.parseEther("10000000"),
            ethers.utils.parseEther("100000")
        );
        let block = await ethers.provider.getBlock("latest");
        const stakingConfig1: StakingConfig = newConfig(
            0.1,
            ethers.utils.parseEther("10000").toString(),
            oneDay * 8,
            oneDay * 2,
            block.timestamp + oneDay // start tomorrow
        );
        const stakingConfig2: StakingConfig = newConfig(
            0.1,
            ethers.utils.parseEther("20000").toString(),
            oneDay * 12,
            oneDay * 1,
            block.timestamp + oneDay * 20 // start the day after tomorrow
        );
        const stakingConfig3: StakingConfig = newConfig(
            0.2,
            ethers.utils.parseEther("20000").toString(),
            oneDay * 12,
            oneDay * 1,
            block.timestamp + oneDay * 50 // start the day after tomorrow
        );

        await setStakingConfig(D, stakingConfig1)
        await setStakingConfig(D, stakingConfig2)
        await setStakingConfig(D, stakingConfig3)
    })
    it(
        "mark a config as dropped, without staked tokens, and flush it",
        async function () {
            for (let key of D.stakingKeys){
                await D.staking.functions.configActive(key)
                    .then((res) => {
                        expect(res[0]).to.be.true
                    })
            }
            // mark config as dropped
            await D.staking.connect(D.owner).functions
                .dropStakingConfig(D.stakingKeys[0])
            // the config should not have any staked tokens
            // and thus can be flushed away
            await D.staking.connect(D.owner).functions
                .flushOldConfigs()
            // checks
            const actives = [false, true, true]
            for (let i=0; i<actives.length;i++){
                await D.staking.functions.configActive(D.stakingKeys[i])
                    .then((res) => {
                        expect(res[0]).to.equal(actives[i])
                    })
            }
        }
    )
    it(
        "flush a config that is already completed and all user claimed",
        async function () {
            for (let key of D.stakingKeys){
                await D.staking.functions.configActive(key)
                    .then((res) => {
                        expect(res[0]).to.be.true
                    })
            }
            await D.staking.functions.getNumberOfActiveConfigs()
                .then((res) => {
                    expect(res[0]).to.equal(3)
                })
            // move the state to completed
            await setConfigToOpen(D, 1)
            await skipFromOpenToLocked(D, 1)
            await skipFromLockedToCompleted(D, 1)
            await D.staking.functions.getConfigState(D.stakingKeys[1])
                .then((res) => {
                    expect(res[0]).to.equal(3)
                })
            // since config 0 ends before config 1, 
            // both configs must be in state completed now
            await D.staking.functions.getConfigState(D.stakingKeys[0])
                .then((res) => {
                    expect(res[0]).to.equal(3)
                })
            // the config should not have any staked tokens
            // and thus can be flushed away
            await D.staking.connect(D.owner).functions
                .flushOldConfigs()
            // checks
            const actives = [false, false, true]
            for (let i=0; i<actives.length;i++){
                await D.staking.functions.configActive(D.stakingKeys[i])
                    .then((res) => {
                        // console.log("active configs check", i, res[0], actives[i])
                        expect(res[0]).to.equal(actives[i])
                    })
            }
            await D.staking.functions.getNumberOfActiveConfigs()
                .then((res) => {
                    expect(res[0]).to.equal(1)
                })
        }
    )
    it(
        "flush a dropped config and a completed config",
        async function () {

        }
    )
    it(
        "[borderCase] try to flush from a contract without configs",
        async function () {
            await expect(
                D2.staking.connect(D2.owner).functions
                    .flushOldConfigs()
            ).to.be.rejectedWith(
                revertMsg("there is no config set")
            )
        }
    )
    it(
        "[borderCase] try to flush when there is no config to remove",
        async function () {
            for (let key of D.stakingKeys){
                await D.staking.functions.configActive(key)
                    .then((res) => {
                        expect(res[0]).to.be.true
                    })
            }
            await D.staking.connect(D.owner).functions
                .flushOldConfigs()
            for (let key of D.stakingKeys){
                await D.staking.functions.configActive(key)
                    .then((res) => {
                        expect(res[0]).to.be.true
                    })
            }
        }
    )
})