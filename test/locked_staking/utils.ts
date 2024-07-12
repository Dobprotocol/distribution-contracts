import { ethers, network } from "hardhat";
import { Contract, Signer, BigNumber } from "ethers";
import { deployExternalToken, deployLockedStaking } from "../utils/deploys";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";

export const oneDay = 86400;
export const zero = BigNumber.from(0);

export interface StakingConfig {
    dprOver10kk: number
    tokensForRewards: string
    lockPeriodDuration: number
    depositPeriodDuration: number
    startDate: number
}

export interface ExpectedBalances {
    contractBalance: BigNumber
    totalStaked: BigNumber
}

export interface ExpectedConfigValues {
    activeUsersCount: BigNumber,
    totalStaked: BigNumber,
    totalClaimed: BigNumber
}

export interface TestingData {
    owner: Signer
    staking: Contract
    token: Contract
    totalTokens: BigNumber
    balances: ExpectedBalances
    stakingConfigs: StakingConfig[],
    stakingKeys: string[],
    stakingValues: ExpectedConfigValues[]
}

export async function configureTest(
    accounts: Signer[], 
    totalTokens: BigNumber = ethers.utils.parseEther("10000000"),
    contractBalance: BigNumber = ethers.utils.parseEther("10000")
) {
    let _owner = accounts[0];
    let _token = await deployExternalToken(
        _owner,
        "testStaking",
        "TST",
        totalTokens.toString()
    )
    let _staking = await deployLockedStaking(
        _owner,
        _token.address,
        _token.address
    )
    const testingData: TestingData = {
        owner: accounts[0],
        staking: _staking,
        token: _token,
        totalTokens: totalTokens,
        balances: {
            contractBalance: contractBalance,
            totalStaked: BigNumber.from(0)
        },
        stakingConfigs: [],
        stakingKeys: [],
        stakingValues: []
    }

    await _token.connect(_owner).functions
        .transfer(
            _staking.address,
            contractBalance.toString()
        )
    return testingData
}

export async function setStakingConfig(
    testingData: TestingData, 
    stakingConfig: StakingConfig
) {
    // set the staking config
    await testingData.staking.connect(testingData.owner)
        .functions.setStakingConfig(stakingConfig)
    // get key
    const [stakingKey] = await testingData.staking.functions.getConfigKey(
        stakingConfig);
    testingData.stakingConfigs.push(stakingConfig)
    testingData.stakingKeys.push(stakingKey)
    testingData.stakingValues.push({
        activeUsersCount: BigNumber.from(0),
        totalStaked: BigNumber.from(0),
        totalClaimed: BigNumber.from(0)
    })
}

export function revertMsg(msg) {
    return "VM Exception while processing transaction: reverted " +
        `with reason string '${msg}'`
}

export function getDPR(apr) {
    let dpr = Math.floor(10000000 * apr / 365);
    // console.log(
    //     "original APR", apr,
    //     "equivalente DPROVER10KK", dpr,
    //     "calculated APR", dpr * 365 / 10000000);
    return dpr;
}

export function newConfig(
    apr: number = 0.1,
    tokensForRewards: string = ethers.utils.parseEther("10").toString(),
    lockPeriodDuration: number = oneDay * 10, // 10 days
    depositPeriodDuration: number = oneDay, // 1 day
    startDate: number = Math.floor(Date.now() / 1000) + oneDay // tomorrow
): StakingConfig {
    
    return {
        dprOver10kk: getDPR(apr),
        tokensForRewards: tokensForRewards,
        lockPeriodDuration: lockPeriodDuration,
        depositPeriodDuration: depositPeriodDuration,
        startDate: startDate
    }
}

export function estimateConfigState(
    ts: number,
    config: StakingConfig
): number {
    /**
     * this function only estimate the states based on changes in timestamp
     * it will not consider special states such as Dropped and notSet.
     */
    if (ts <= config.startDate) return 0
    else if (config.startDate <= ts &&
        ts < config.startDate + config.depositPeriodDuration) return 1
    else if (config.startDate + config.depositPeriodDuration <= ts &&
        ts < config.startDate + config.depositPeriodDuration + config.lockPeriodDuration) return 2
    else if (config.startDate + config.depositPeriodDuration + config.lockPeriodDuration <= ts) return 3
    else return -1
}

export async function stakeTokens(
    D: TestingData, 
    user: SignerWithAddress, 
    stakeAmount: BigNumber,
    configId: number
){
    const stakingKey = D.stakingKeys[configId]
    // transfer tokens to user address
    await D.token.connect(D.owner)
        .functions.transfer(user.address, stakeAmount.toString())
    // do the allowance
    await D.token.connect(user)
        .functions.approve(D.staking.address, stakeAmount.toString())
    // do the stake
    await D.staking.connect(user)
        .functions.stake(stakingKey, stakeAmount.toString())

    // update balances and values
    D.balances.contractBalance = 
        D.balances.contractBalance.add(stakeAmount);
    D.balances.totalStaked = 
        D.balances.totalStaked.add(stakeAmount);
    D.stakingValues[configId].activeUsersCount = 
        D.stakingValues[configId].activeUsersCount.add(BigNumber.from(1));
    D.stakingValues[configId].totalStaked = 
        D.stakingValues[configId].totalStaked.add(stakeAmount);
}

export async function claimTokens(
    D: TestingData,
    user: SignerWithAddress,
    configId: number
){ 
    const stakingKey = D.stakingKeys[configId]
    const [stakeAmount] = await D.staking.functions
        .getConfigUserStakedAmount(stakingKey, user.address)
    const [rewardAmount] = await D.staking.functions
        .estimateConfigUserRewards(stakingKey, user.address)
    await D.staking.connect(user)
        .functions.claim(stakingKey)

    // update balances and values
    D.balances.contractBalance = 
        D.balances.contractBalance.sub(stakeAmount).sub(rewardAmount);
    D.balances.totalStaked = 
        D.balances.totalStaked.sub(stakeAmount);
    D.stakingValues[configId].activeUsersCount = 
        D.stakingValues[configId].activeUsersCount.sub(BigNumber.from(1));
    D.stakingValues[configId].totalStaked = 
        D.stakingValues[configId].totalStaked.sub(stakeAmount);
    D.stakingValues[configId].totalClaimed = 
        D.stakingValues[configId].totalClaimed.add(rewardAmount);
}

export async function earlyWithdrawTokens(
    D: TestingData,
    user: SignerWithAddress,
    configId: number
){
    const stakingKey = D.stakingKeys[configId]
    const [stakeAmount] = await D.staking.functions
        .getConfigUserStakedAmount(stakingKey, user.address)

    // made an early withdraw
    await D.staking.connect(user).functions
        .earlyWithdraw(stakingKey)

    // update balances and values
    D.balances.contractBalance = 
        D.balances.contractBalance.sub(stakeAmount);
    D.balances.totalStaked = 
        D.balances.totalStaked.sub(stakeAmount);
    D.stakingValues[configId].activeUsersCount = 
        D.stakingValues[configId].activeUsersCount.sub(BigNumber.from(1));
    D.stakingValues[configId].totalStaked = 
        D.stakingValues[configId].totalStaked.sub(stakeAmount);

}

export async function withdrawRemainsTokens(
    D: TestingData
){
    const [totalLockedTokens] = await D.staking.functions.getTotalLockedTokens();
    const [balance] = await D.token.functions.balanceOf(D.staking.address);
    const notLockedTokens = balance.sub(totalLockedTokens);

    await D.staking.connect(D.owner).functions.withdrawRemains();

    // update balances
    D.balances.contractBalance = 
        D.balances.contractBalance.sub(notLockedTokens);
}

export async function checkUserStaked(
    D: TestingData,
    configId: number,
    user: SignerWithAddress,
    userExpectedStaked: BigNumber,
){
    const stakingKey = D.stakingKeys[configId];
    await D.staking.functions.getConfigUserStakedAmount(stakingKey, user.address)
        .then((res) => {
            console.log(`[test] getConfigUserStakedAmount ${res[0].toString()} =?= ${userExpectedStaked.toString()}`)
            expect(res[0]).to.equal(userExpectedStaked)
        })
}


export async function checkBalances(
    D: TestingData,
    configId: number
){
    const expectedBalances = D.balances;
    const stakingKey = D.stakingKeys[configId];
    const expectedConfigValues = D.stakingValues[configId];

    // check the total staked tokens in the contract
    await D.staking.functions.getTotalLockedStakedAmount()
        .then((res) => {
            console.log(`[test] getTotalLockedStakedAmount ${res[0].toString()} =?= ${expectedBalances.totalStaked.toString()}`)
            expect(res[0]).to.equal(expectedBalances.totalStaked)
        })
    // check the config usage
    await D.staking.functions.getConfigUsageData(stakingKey)
        .then((res) => {
            expect(res.activeUsersCount).to.equal(expectedConfigValues.activeUsersCount);
            expect(res.totalStaked).to.equal(expectedConfigValues.totalStaked);
            expect(res.totalClaimed).to.equal(expectedConfigValues.totalClaimed);
        })

    // check contract balance
    await D.token.connect(D.owner).balanceOf(D.staking.address)
        .then((res) => {
            expect(res).to.equal(expectedBalances.contractBalance)
        })
}

export async function setConfigToOpen(
    D: TestingData,
    configId: number
){
    let block = await ethers.provider.getBlock("latest")
    let step = D.stakingConfigs[configId].startDate - block.timestamp + 60;
    await network.provider.send("evm_increaseTime", [step]);
    await network.provider.send("evm_mine");
}

export async function skipFromOpenToLocked(
    D: TestingData,
    configId: number
){
    let step = D.stakingConfigs[configId].depositPeriodDuration
    await network.provider.send("evm_increaseTime", [step]);
    await network.provider.send("evm_mine");
}

export async function skipFromLockedToCompleted(
    D: TestingData,
    configId: number
){
    let step = D.stakingConfigs[configId].lockPeriodDuration
    await network.provider.send("evm_increaseTime", [step]);
    await network.provider.send("evm_mine");
}