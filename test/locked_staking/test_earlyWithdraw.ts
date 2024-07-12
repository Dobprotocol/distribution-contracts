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

describe("TEST earlyWithdraw() function interactions", function () {
    let accounts: SignerWithAddress[];
    let D: TestingData;
    beforeEach(async function () {
        accounts = await ethers.getSigners();
        D = await configureTest(
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
        await setStakingConfig(D, stakingConfig2)
    })
    it(
        "early withdraw from a Opened config",
        async function () {
            const configId = 0;
            // move timestamp so the config state changes to Opened
            await setConfigToOpen(D, configId)

            // define the amount to deposit and the user
            const stakeAmount = ethers.utils.parseEther("5")
            const user = accounts[1]
            // do staking
            await stakeTokens(D, user, stakeAmount, configId);

            // made an early withdraw while state is Opened
            await earlyWithdrawTokens(D, user, configId);

            // check balances and values
            await checkBalances(D, configId);
            await checkUserStaked(D, configId, user, zero);

            // check user balance of tokens
            await D.token.functions.balanceOf(user.address)
                .then((res) => {
                    expect(res[0]).to.equal(stakeAmount)
                })
        }
    )
    it(
        "early withdraw from a Locked config",
        async function () {
            const configId = 0;
            // move timestamp so the config state changes to Opened
            await setConfigToOpen(D, configId)

            // define the amount to deposit and the user
            const stakeAmount = ethers.utils.parseEther("5")
            const user = accounts[1]
            // do staking
            await stakeTokens(D, user, stakeAmount, configId);

            // move state to Locked
            await skipFromOpenToLocked(D, configId)

            // made an early withdraw while state is Opened
            await earlyWithdrawTokens(D, user, configId);

            // check balances and values
            await checkBalances(D, configId);
            await checkUserStaked(D, configId, user, zero);

            // check user balance of tokens
            await D.token.functions.balanceOf(user.address)
                .then((res) => {
                    expect(res[0]).to.equal(stakeAmount)
                })
        }
    )
    it(
        "early withdraw from a Dropped config",
        async function () {
            const configId = 0;
            // move timestamp so the config state changes to Opened
            await setConfigToOpen(D, configId)

            // define the amount to deposit and the user
            const stakeAmount = ethers.utils.parseEther("5")
            const user = accounts[1]
            // do staking
            await stakeTokens(D, user, stakeAmount, configId);

            // move state to Completed
            await skipFromOpenToLocked(D, configId)
            await skipFromLockedToCompleted(D, configId);
            // drop the config
            await D.staking.connect(D.owner).functions
                .dropStakingConfig(D.stakingKeys[configId])

            // made an early withdraw while state is Dropped
            await earlyWithdrawTokens(D, user, configId);

            // check balances and values
            await checkBalances(D, configId);
            await checkUserStaked(D, configId, user, zero);

            // check user balance of tokens
            await D.token.functions.balanceOf(user.address)
                .then((res) => {
                    expect(res[0]).to.equal(stakeAmount)
                })
        }
    )
    it(
        "[borderCase] try to early withdraw from a Completed config",
        async function () {
            const configId = 0;
            // move timestamp so the config state changes to Opened
            await setConfigToOpen(D, configId)

            // define the amount to deposit and the user
            const stakeAmount = ethers.utils.parseEther("5")
            const user = accounts[1]
            // do staking
            await stakeTokens(D, user, stakeAmount, configId);

            // move state to Completed
            await skipFromOpenToLocked(D, configId)
            await skipFromLockedToCompleted(D, configId);

            // try to made an early withdraw while state is Completed
            await expect(
                earlyWithdrawTokens(D, user, configId)
            ).to.be.rejectedWith(
                revertMsg("config must be in state [Opened, Locked, Dropped]")
            )
        }
    )
    it(
        "[borderCase] try to early withdraw from a notSet config",
        async function () {
            let block = await ethers.provider.getBlock("latest")
            const notSetConfig: StakingConfig = newConfig(
                0.4,
                ethers.utils.parseEther("20000").toString(),
                oneDay * 12,
                oneDay * 1,
                block.timestamp + oneDay * 2 // start the day after tomorrow
            );
            const [stakingKey] = await D.staking.functions.getConfigKey(notSetConfig);
            const user = accounts[1]

            // try to made an early withdraw while state is Completed
            await expect(
                D.staking.connect(user).functions
                    .earlyWithdraw(stakingKey)
            ).to.be.rejectedWith(
                revertMsg("config must be in state [Opened, Locked, Dropped]")
            )
        }
    )
    it(
        "[borderCase] try to early withdraw from a PreOpened config",
        async function () {
            const configId = 1;
            const user = accounts[1]
            // try to made an early withdraw while state is PreOpened
            await expect(
                earlyWithdrawTokens(D, user, configId)
            ).to.be.rejectedWith(
                revertMsg("config must be in state [Opened, Locked, Dropped]")
            )
        }
    )
    it(
        "[borderCase] try to early withdraw when user has no stake",
        async function () {
            const configId = 0;
            // move timestamp so the config state changes to Opened
            await setConfigToOpen(D, configId)

            // define the user
            const user = accounts[1]

            // try to made an early withdraw while state is Opened
            // and user has no stake
            await expect(
                earlyWithdrawTokens(D, user, configId)
            ).to.be.rejectedWith(
                revertMsg("user has no staked tokens")
            )

        }
    )
})