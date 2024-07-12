import { ethers, network } from "hardhat";
import { expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployExternalToken, deployLockedStaking } from "../utils/deploys";
import { Contract, Signer, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { 
    revertMsg, 
    StakingConfig, 
    newConfig, 
    oneDay, 
    TestingData, 
    configureTest, 
    setStakingConfig
} from "./utils";

describe("TEST ownership conditions", function () {
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
        await setStakingConfig(D, stakingConfig1)
    })
    it(
        "only the owner can call withdrawRemains",
        async function () {
            const user = accounts[1];
            await expect(
                D.staking.connect(user).functions.withdrawRemains()
            ).to.be.rejectedWith(
                revertMsg("Ownable: caller is not the owner")
            )
        }
    )

    it(
        "only the owner can set a new config",
        async function () {
            const user = accounts[1];
            let block = await ethers.provider.getBlock("latest");
            const stakingConfig2: StakingConfig = newConfig(
                0.1,
                ethers.utils.parseEther("20000").toString(),
                oneDay * 12,
                oneDay * 1,
                block.timestamp + oneDay * 2 // start the day after tomorrow
            );
            await expect(
                D.staking.connect(user).functions
                    .setStakingConfig(stakingConfig2)
            ).to.be.rejectedWith(
                revertMsg("Ownable: caller is not the owner")
            )
        }
    )

    it(
        "only the owner can drop a config",
        async function () {
            const user = accounts[1];
            await expect(
                D.staking.connect(user).functions
                    .dropStakingConfig(D.stakingKeys[0])
            ).to.be.rejectedWith(
                revertMsg("Ownable: caller is not the owner")
            )
        }
    )

    it(
        "only the owner can flush old configs",
        async function () {
            const user = accounts[1];
            await expect(
                D.staking.connect(user).functions
                    .flushOldConfigs()
            ).to.be.rejectedWith(
                revertMsg("Ownable: caller is not the owner")
            )
        }
    )

    it(
        "only the owner can update staking configs",
        async function () {
            const user = accounts[1];
            await expect(
                D.staking.connect(user).functions
                    .updateStakingConfig(
                        D.stakingKeys[0], 
                        ethers.utils.parseEther("5000").toString()
                    )
            ).to.be.rejectedWith(
                revertMsg("Ownable: caller is not the owner")
            )
        }
    )
})