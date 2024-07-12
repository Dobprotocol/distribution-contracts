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
    stakeTokens 
} from "./utils";

describe("TEST claim() function interactions", function () {
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
        "claim stake+rewards from a Completed config",
        async function () {
            const configId = 0;
            // move timestamp so the config state changes to Opened
            let block = await ethers.provider.getBlock("latest")
            let step = D.stakingConfigs[configId].startDate - block.timestamp + 60;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");

            // define the amount to deposit and the user
            const stakeAmount = ethers.utils.parseEther("5")
            const user = accounts[1]
            // do staking
            await stakeTokens(D, user, stakeAmount, configId);

            // move timestamp so the config state changes to Completed
            step = D.stakingConfigs[configId].depositPeriodDuration +
                D.stakingConfigs[configId].lockPeriodDuration
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");
            // claim rewards and staked tokens
            await claimTokens(D, user, configId);

            // check balances and values
            await checkBalances(D, configId);
            await checkUserStaked(D, configId, user, zero);
        }
    )
    it(
        "[borderCase] try to claim when user has no staked tokens",
        async function () {
            const configId = 0;
            const user = accounts[1];
            // move timestamp so the config state changes to Closed
            let block = await ethers.provider.getBlock("latest")
            let step = 
                D.stakingConfigs[configId].startDate - block.timestamp +
                D.stakingConfigs[configId].depositPeriodDuration +
                D.stakingConfigs[configId].lockPeriodDuration + 60;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");

            // try to claim
            await expect(
                claimTokens(D, user, configId)
            ).to.be.rejectedWith(
                revertMsg("user does not have staked tokens")
            )

        }
    )
    it(
        "[borderCase] try to claim when config is not Completed",
        async function () {
            const configId = 0;
            const user = accounts[1];
            const stakeAmount = ethers.utils.parseEther("5")
            // try to claim when is preOpened
            await expect(
                claimTokens(D, user, configId)
            ).to.be.rejectedWith(
                revertMsg("config must be in state Completed")
            )

            // move timestamp so the config state changes to Opened
            let block = await ethers.provider.getBlock("latest")
            let step = 
                D.stakingConfigs[configId].startDate - block.timestamp + 60;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");

            // stake
            await stakeTokens(D, user, stakeAmount, configId);

            // try to claim when is Opened
            await expect(
                claimTokens(D, user, configId)
            ).to.be.rejectedWith(
                revertMsg("config must be in state Completed")
            )

            // move to state Locked
            step = D.stakingConfigs[configId].depositPeriodDuration;
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");

            // try to claim when is Locked
            await expect(
                claimTokens(D, user, configId)
            ).to.be.rejectedWith(
                revertMsg("config must be in state Completed")
            )

            // drop the config
            await D.staking.connect(D.owner).functions
                .dropStakingConfig(D.stakingKeys[configId])

            // try to claim when is Dropped
            await expect(
                claimTokens(D, user, configId)
            ).to.be.rejectedWith(
                revertMsg("config must be in state Completed")
            )
        }
    )
    it(
        "[borderCase] try to claim from a notSet config",
        async function () {
            const user = accounts[1];
            let block = await ethers.provider.getBlock("latest")
            
            // try to claim from a notSet config
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
                    .functions.claim(stakingKey)
            ).to.be.rejectedWith(
                revertMsg("config must be in state Completed")
            )
        }
    )
})