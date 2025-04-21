import { ethers, network } from "hardhat";
import { expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { Contract, Signer, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { checkUserStaked, checkBalances, revertMsg, StakingConfig, newConfig, oneDay, TestingData, configureTest, setStakingConfig, stakeTokens } from "./utils";

describe("TEST staking logic interactions", function () {
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
        "add tokens to stake in specific config and related getters",
        async function () {
            const configId = 0

            await checkBalances(D, configId)

            // move timestamp so the config state changes to Opened
            let block = await ethers.provider.getBlock("latest")
            let step = D.stakingConfigs[configId].startDate - block.timestamp + 60;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");


            // define the amount to deposit and the user
            const stakeAmount = ethers.utils.parseEther("5")
            const user = accounts[1]
            // check that the config can support this amount
            await D.staking.connect(user).functions.getMaxStakeToken(D.stakingKeys[configId])
                .then((res) => {
                    // console.log("res", res.toString(), "stakeAmount", stakeAmount.toString())
                    expect(res[0]).to.be.gt(stakeAmount)
                })

            // do staking
            await stakeTokens(D, user, stakeAmount, configId);

            // check balances and variables
            await checkBalances(D, configId)
        }
    )
    it(
        "add tokens twice to the same config",
        async function () {
            const configId = 0
            // define the amount to deposit and the user
            const stakeAmount1 = ethers.utils.parseEther("5")
            const stakeAmount2 = ethers.utils.parseEther("7")
            const user = accounts[2]

            // move timestamp so the config state changes to Opened
            let block = await ethers.provider.getBlock("latest")
            let step = D.stakingConfigs[configId].startDate - block.timestamp + 60;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");

            // do staking
            await stakeTokens(D, user, stakeAmount1, configId);
            // do staking again
            await stakeTokens(D, user, stakeAmount2, configId);

            // check balances
            await checkBalances(D, configId)
        }
    )
    it(
        "two users add tokens to the same config",
        async function () {
            const configId = 0
            // define the amount to deposit and the users
            const stakeAmount1 = ethers.utils.parseEther("4")
            const stakeAmount2 = ethers.utils.parseEther("6")
            const user1 = accounts[2]
            const user2 = accounts[3]

            // move timestamp so the config state changes to Opened
            let block = await ethers.provider.getBlock("latest")
            let step = D.stakingConfigs[configId].startDate - block.timestamp + 60;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");

            // do staking from user 1
            await stakeTokens(D, user1, stakeAmount1, configId);
            // do staking from user 2
            await stakeTokens(D, user2, stakeAmount2, configId);

            // check balances
            await checkBalances(D, configId)
            await checkUserStaked(D, configId, user1, stakeAmount1);
            await checkUserStaked(D, configId, user2, stakeAmount2);
        }
    )

    it(
        "add tokens to two different configs",
        async function () {
            const configIds = [0, 1]
            const stakeAmounts = [
                ethers.utils.parseEther("3"),
                ethers.utils.parseEther("5")
            ]
            const users = [
                accounts[4],
                accounts[5]
            ]
            for (let i = 0; i < configIds.length; i++) {
                const stakeAmount = stakeAmounts[i]
                const configId = configIds[i]
                const user = users[i]

                // move timestamp so the config state changes to Opened
                let block = await ethers.provider.getBlock("latest")
                let step = D.stakingConfigs[configId].startDate - block.timestamp + 60;
                await network.provider.send("evm_increaseTime", [step]);
                await network.provider.send("evm_mine");

                // do staking
                await stakeTokens(D, user, stakeAmount, configId);
            }
            // check balances
            await checkBalances(D, configIds[0])
            await checkUserStaked(D, configIds[0], users[0], stakeAmounts[0]);
            await checkBalances(D, configIds[1])
            await checkUserStaked(D, configIds[1], users[1], stakeAmounts[1]);
        }
    )
    it(
        "[borderCase] try to add tokens to a config that is not Opened",
        async function () {
            const configId = 0
            const config = D.stakingConfigs[configId];
            // define the amount to deposit and the user
            const stakeAmount = ethers.utils.parseEther("5")
            const user = accounts[2]

            // config is PreOpened
            await D.staking.functions.isPreOpened(D.stakingKeys[configId])
                .then((res) => {
                    expect(res[0]).to.be.true
                })
            await expect(
                stakeTokens(D, user, stakeAmount, configId)
            ).to.be.rejectedWith(
                revertMsg("config must be in state Opened")
            )


            // move timestamp so the config state changes to Locked
            let block = await ethers.provider.getBlock("latest")
            let step = config.startDate - block.timestamp + config.depositPeriodDuration + 60;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");

            // config is Locked
            await D.staking.functions.isLocked(D.stakingKeys[configId])
                .then((res) => {
                    expect(res[0]).to.be.true
                })
            await expect(
                stakeTokens(D, user, stakeAmount, configId)
            ).to.be.rejectedWith(
                revertMsg("config must be in state Opened")
            )

            // move timestamp so the config state changes to Completed
            step = config.lockPeriodDuration;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");

            // config is Completed
            await D.staking.functions.isCompleted(D.stakingKeys[configId])
                .then((res) => {
                    expect(res[0]).to.be.true
                })
            await expect(
                stakeTokens(D, user, stakeAmount, configId)
            ).to.be.rejectedWith(
                revertMsg("config must be in state Opened")
            )
        }
    )

    it(
        "[borderCase] try to add more than the maxStakeAmount",
        async function () {
            const configId = 0
            const stakingKey = D.stakingKeys[configId]
            const [maxStakeAmount] = await D.staking.functions.getMaxStakeToken(stakingKey)
            const user = accounts[2]


            let block = await ethers.provider.getBlock("latest")
            let step = D.stakingConfigs[configId].startDate - block.timestamp + 60;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");
            expect(
                stakeTokens(D, user, maxStakeAmount.add(BigNumber.from(1)), configId)
            ).to.be.rejectedWith(
                revertMsg("cannot stake more than the allowed amount")
            )

            // but we can stake the 'maxStakeAmount' exactly

            await stakeTokens(D, user, maxStakeAmount, configId)

            await checkBalances(D, configId)
            await checkUserStaked(D, configId, user, maxStakeAmount);
        }
    )

    it(
        "[borderCase] try to add more than the allowance",
        async function () {
            const configId = 0
            // define the amount to deposit and the user
            const stakeAmount = ethers.utils.parseEther("5")
            const user = accounts[2]

            // move timestamp so the config state changes to Opened
            let block = await ethers.provider.getBlock("latest")
            let step = D.stakingConfigs[configId].startDate - block.timestamp + 60;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");

            const stakingKey = D.stakingKeys[configId]
            // transfer tokens to user address
            await D.token.connect(D.owner)
                .functions.transfer(user.address, stakeAmount.toString())
            // do the allowance
            await D.token.connect(user)
                .functions.approve(D.staking.address, stakeAmount.sub(BigNumber.from(1)).toString())
            // try to stake mor the approved amount
            await expect(
                D.staking.connect(user)
                    .functions.stake(stakingKey, stakeAmount.toString())
            ).to.be.rejectedWith(
                revertMsg("ERC20: insufficient allowance")
            )
        }
    )

    it(
        "[borderCase] try to add more than the current balance",
        async function () {
            const configId = 0
            // define the amount to deposit and the user
            const stakeAmount = ethers.utils.parseEther("5")
            const user = accounts[2]

            // move timestamp so the config state changes to Opened
            let block = await ethers.provider.getBlock("latest")
            let step = D.stakingConfigs[configId].startDate - block.timestamp + 60;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");

            const stakingKey = D.stakingKeys[configId]
            // transfer tokens to user address
            await D.token.connect(D.owner)
                .functions.transfer(user.address, stakeAmount.sub(BigNumber.from(1)).toString())
            // do the allowance
            await D.token.connect(user)
                .functions.approve(D.staking.address, stakeAmount.toString())
            // try to stake mor the approved amount
            await expect(
                D.staking.connect(user)
                    .functions.stake(stakingKey, stakeAmount.toString())
            ).to.be.rejectedWith(
                revertMsg("ERC20: transfer amount exceeds balance")
            )
        }
    )

    it(
        "[borderCase] try to add twice, once when config is Opened and then when is Locked",
        async function () {
            const configId = 0
            // define the amount to deposit and the user
            const stakeAmount1 = ethers.utils.parseEther("5")
            const stakeAmount2 = ethers.utils.parseEther("7")
            const user = accounts[2]

            // move timestamp so the config state changes to Opened
            let block = await ethers.provider.getBlock("latest")
            let step = D.stakingConfigs[configId].startDate - block.timestamp + 60;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");

            // do staking
            await stakeTokens(D, user, stakeAmount1, configId);

            // move timestamp so the config state changes to Locked
            step = D.stakingConfigs[configId].depositPeriodDuration
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");

            // try staking again
            await expect(
                stakeTokens(D, user, stakeAmount2, configId)
            ).to.be.rejectedWith(
                revertMsg("config must be in state Opened")
            )

            // check balances
            await checkBalances(D, configId)
            await checkUserStaked(D, configId, user, stakeAmount1);
        }
    )
    it (
        "[BorderCase] try to stake to a notSet config",
        async function(){
            const configId = 0
            let block = await ethers.provider.getBlock("latest")
            const user = accounts[1];
            const stakeAmount = ethers.utils.parseEther("5")
            const notSetConfig: StakingConfig = newConfig(
                0.4,
                ethers.utils.parseEther("20000").toString(),
                oneDay * 12,
                oneDay * 1,
                block.timestamp + oneDay * 2 // start the day after tomorrow
            );
            const [stakingKey] = await D.staking.functions.getConfigKey(notSetConfig);
            
            await expect(
                D.staking.connect(user)
                .functions.stake(stakingKey, stakeAmount.toString())
            ).to.be.rejectedWith(
                revertMsg("config must be in state Opened")
            )
        }
    )

})