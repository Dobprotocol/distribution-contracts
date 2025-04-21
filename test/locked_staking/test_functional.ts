import { ethers, network } from "hardhat";
import { expect } from "chai";
import "@nomiclabs/hardhat-web3";
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
import { BigNumber } from "ethers";


describe("TEST integral functionality of the contract", function () {
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
            ethers.utils.parseEther("10").toString(),
            oneDay * 30 * 6, // 6 months
            oneDay * 7, // 1 week
            block.timestamp + oneDay // start tomorrow
        );
        await setStakingConfig(D, stakingConfig1)
    })
    it("test multiple users staking in 1 config", async function(){
        const users = [
            accounts[1],
            accounts[2],
            accounts[3],
            accounts[5]
        ]
        const stakeAmounts = [
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("10"),
            ethers.utils.parseEther("100"),
            ethers.utils.parseEther("50")
        ]

        await D.staking.functions.getMaxStakeToken(D.stakingKeys[0])
            .then((res) => {
                console.log("max stake amount is:", ethers.utils.formatEther(res.maxStake))
            })
        // move config to state Opened
        setConfigToOpen(D, 0)

        // stake
        for (let i=0;i<users.length;i++){
            await stakeTokens(D, users[i], stakeAmounts[i], 0)
        }

        // move config to state Completed
        skipFromOpenToLocked(D, 0)
        skipFromLockedToCompleted(D, 0)

        // claim stake+rewards
        let userExpectedBalances: BigNumber[] = []
        for (let i=0;i<users.length;i++){
            let [expectedReward] = await D.staking.functions
                .estimateConfigUserRewards(D.stakingKeys[0], users[i].address)
            console.log(`user ${users[i].address} expected rewards: ${ethers.utils.formatEther(expectedReward)}`)
            userExpectedBalances.push(expectedReward.add(stakeAmounts[i]))
            await claimTokens(D, users[i], 0)
        }

        await checkBalances(D, 0)
        for (let i=0;i<users.length;i++){
            await checkUserStaked(D, 0, users[i], zero)
            let [balance] = await D.token.functions.balanceOf(users[i].address)
            console.log(`user ${users[i].address} balance ${balance}==${userExpectedBalances[i]}`)
            expect(balance).to.equal(userExpectedBalances[i])
        }

    })
})