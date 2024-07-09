import { ethers, network } from "hardhat";
import { Contract, Signer, BigNumber } from "ethers";

export const oneDay = 86400;
export const zero = BigNumber.from(0);

export interface StakingConfig {
    dprOver10kk: number
    tokensForRewards: string
    lockPeriodDuration: number
    depositPeriodDuration: number
    startDate: number
}

export function revertMsg(msg){
    return "VM Exception while processing transaction: reverted " +
    `with reason string '${msg}'`
}

export function getDPR(apr){
    let dpr = Math.floor(10000000 * apr / 365);
        console.log(
            "original APR", apr,
            "equivalente DPROVER10KK", dpr,
            "calculated APR", dpr * 365 / 10000000);
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
    else if(config.startDate <= ts && 
        ts < config.startDate + config.depositPeriodDuration) return 1
    else if (config.startDate + config.depositPeriodDuration <= ts &&
        ts < config.startDate + config.depositPeriodDuration + config.lockPeriodDuration) return 2
    else if (config.startDate + config.depositPeriodDuration + config.lockPeriodDuration <= ts) return 3
    else return -1
}