import { ethers, upgrades } from "hardhat"
import { Contract, Signer } from "ethers"
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export async function getNextDistributionDate(pool: Contract, token: string, user: Signer) {
    let nextDist = -1;
    await pool.connect(user)
        .functions.getDistributionDates(token)
        .then((res) => {
            nextDist = +res.firstDistributionDate + (+res.distributionInterval * +res.index);
        })
        .catch((err) => {
            console.log("failed to get nextDist with err:", err)
        })
    return nextDist;
}

export async function simulateDistribution(
    pool: Contract, amount: BigNumber, 
    poolUsers: string[], poolShares: number[],
    commission: number = 3
) : Promise<BigNumber[]> {

    console.log(":::: simulating distribution ::::")

    let accounts = await ethers.getSigners();

    let tokenAddress = await pool.connect(accounts[10])
        .functions.getParticipationToken()
    let token  = await ethers.getContractAt("ParticipationToken", tokenAddress[0]);

    let effectiveAmount = amount.mul(100-commission).div(100);
    console.log("--> amount to distribute after commission:", effectiveAmount.toString());
    let totalShare = 0;
    for (let _share of poolShares){
        totalShare += _share
    };
    let tokenTotalSupply = await token.totalSupply();
    console.log("----> token total supply", tokenTotalSupply.toString());
    let assignedAmounts: BigNumber[] = [];
    for (let i =0; i < poolUsers.length; i++){
        let tokenShare = await token.balanceOf(poolUsers[i])
        console.log("----> address", poolUsers[i], "token share", tokenShare.toString());
        let assignedAmount = effectiveAmount.mul(tokenShare).div(tokenTotalSupply);
        console.log("---> address", poolUsers[i], "should get ", assignedAmount.toString());
        // reconstructedAmount = assignedAmount.add(reconstructedAmount);
        assignedAmounts.push(assignedAmount);
    }
    console.log(":::::::::::::::::::::::::::::: ")
    return assignedAmounts;
}

export function getSigner(
    _address: string, accounts: SignerWithAddress[]
): SignerWithAddress {
    for (let acc of accounts) {
        if (acc.address == _address){
            return acc;
        }
    }
    throw "failed to get signer"
}