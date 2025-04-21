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
    skipFromOpenToLocked,
    withdrawRemainsTokens
} from "./utils";

describe("TEST  withdrawRemains() function interactions", function () {
    let accounts: SignerWithAddress[];
    let D: TestingData;
    let D2: TestingData;
    let D3: TestingData;
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
        D3 = await configureTest(
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
            block.timestamp + oneDay * 2 // start the day after tomorrow
        );

        await setStakingConfig(D, stakingConfig1)
        await setStakingConfig(D3, stakingConfig1)
        await setStakingConfig(D, stakingConfig2)
    })
    it(
        "withdraw remains from a pool with no active configs",
        async function () {
            await withdrawRemainsTokens(D2);

            // check contract balance
            await D2.token.connect(D2.owner).balanceOf(D2.staking.address)
            .then((res) => {
                expect(res).to.equal(zero)
            })
        }
    )
    it(
        "withdraw remains from a pool with 1 config in state PreOpened",
        async function () {
            const configId = 0;
            await withdrawRemainsTokens(D3);
            await checkBalances(D3, configId)
        }
    )
    it(
        "withdraw remains from a pool with 1 config in state Opened",
        async function () {
            const configId = 0;
            await setConfigToOpen(D3, configId);
            await withdrawRemainsTokens(D3);
            await checkBalances(D3, configId);
        }
    )
    it(
        "withdraw remains from a pool with 1 config in state Locked",
        async function () {
            const configId = 0;
            // move to state Opened
            await setConfigToOpen(D3, configId);
            // deposit some funds
            const user = accounts[1];
            const stakeAmount = ethers.utils.parseEther("5")
            await stakeTokens(D3, user, stakeAmount, configId);
            // move to state Locked
            await skipFromOpenToLocked(D3, configId);
            // withdraw remains
            await withdrawRemainsTokens(D3);
            // check balances and variables
            await checkBalances(D3, configId);
        }
    )
    it(
        "withdraw remains from a pool with 2 config in states Opened and Locked",
        async function () {

            // move config [0,1] to state Opened
            await setConfigToOpen(D, 0);
            await setConfigToOpen(D, 1);
            // deposit some funds in boths
            await stakeTokens(
                D, accounts[1], ethers.utils.parseEther("5"), 0);
            await stakeTokens(
                D, accounts[2], ethers.utils.parseEther("4"), 1);
            // move config [1] to state Locked
            await skipFromOpenToLocked(D, 1);
            // withdraw remains
            await withdrawRemainsTokens(D);
            // check balances and variables
            await checkBalances(D, 0);
            await checkBalances(D, 1);
        }
    )
    it(
        "withdraw remains from a pool with 2 config in states Opened and Dropped",
        async function () {
            // move config [0,1] to state Opened
            await setConfigToOpen(D, 0);
            await setConfigToOpen(D, 1);
            // deposit some funds in boths
            await stakeTokens(
                D, accounts[1], ethers.utils.parseEther("5"), 0);
            await stakeTokens(
                D, accounts[2], ethers.utils.parseEther("4"), 1);
            // move config [1] to state Dropped
            await D.staking.connect(D.owner).functions
                .dropStakingConfig(D.stakingKeys[1])
            // withdraw remains
            await withdrawRemainsTokens(D);
            // check balances and variables
            await checkBalances(D, 0);
            await checkBalances(D, 1);
        }
    )
    it(
        "[borderCase] try to withdraw when there is no tokens available",
        async function () {
            // withdraw twice from the contract without configs [D2]
            await withdrawRemainsTokens(D2);
            await expect(
                withdrawRemainsTokens(D2)
            ).to.be.rejectedWith(
                revertMsg("no tokens available to withdraw")
            )
        }
    )
})