import { ethers, network } from "hardhat";
import { expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployExternalToken, deployLockedStaking } from "../utils/deploys";
import { Contract, Signer, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { revertMsg, StakingConfig, getDPR, newConfig, oneDay } from "./utils";

describe("TEST updateConfig() function interactions", function () {
    let accounts: SignerWithAddress[];
    let _owner: Signer;
    let _staking: Contract;
    let _token: Contract;
    let _zero: BigNumber;
    let _stakingConfig1: StakingConfig;
    beforeEach(async function () {
        accounts = await ethers.getSigners();
        _owner = accounts[0];
        _token = await deployExternalToken(
            _owner,
            "testStaking",
            "TST",
            ethers.utils.parseEther("1000").toString()
        )
        _staking = await deployLockedStaking(
            _owner,
            _token.address,
            _token.address
        )

        await _token.connect(_owner).functions
            .transfer(
                _staking.address,
                ethers.utils.parseEther("100").toString()
            )
        _zero = BigNumber.from(0)
        _stakingConfig1 = newConfig()
        let block = await ethers.provider.getBlock("latest");
        _stakingConfig1.startDate = block.timestamp + oneDay;
    })

    it("update staking config and relative getters", async function () {
        // set the staking config
        await _staking.connect(_owner)
            .functions.setStakingConfig(_stakingConfig1)
        // skip 1 block
        network.provider.send("evm_mine");
        // update the config tokensForRewards
        const newTokensForRewards = ethers.utils.parseEther("5").toString()
        const [stakingKey] = await _staking.functions.getConfigKey(_stakingConfig1);
        await _staking.connect(_owner)
            .functions.updateStakingConfig(stakingKey, newTokensForRewards)

        // check the updated config
        await _staking.functions.getStakingConfig(stakingKey)
            .then((res) => {
                expect(res[0].dprOver10kk).to.equal(
                    BigNumber.from(_stakingConfig1.dprOver10kk));
                expect(res[0].tokensForRewards).to.equal(
                    BigNumber.from(newTokensForRewards));
                expect(res[0].lockPeriodDuration).to.equal(
                    BigNumber.from(_stakingConfig1.lockPeriodDuration));
                expect(res[0].depositPeriodDuration).to.equal(
                    BigNumber.from(_stakingConfig1.depositPeriodDuration));
                expect(res[0].startDate).to.equal(
                    BigNumber.from(_stakingConfig1.startDate));
            })
    })
    it(
        "[borderCase] should revert if config is Locked",
        async function () {
            const [stakingKey] = await _staking.functions.getConfigKey(_stakingConfig1);
            const newTokensForRewards = ethers.utils.parseEther("5").toString()
            // set config
            await _staking.connect(_owner)
                .functions.setStakingConfig(_stakingConfig1)
            // lock config by moving the timestamp of the blockchain
            // move block timestamp to 
            // startDate+depositPeriodDuration+1
            let block = await ethers.provider.getBlock("latest");
            let offsetToStart = _stakingConfig1.startDate - block.timestamp
            let tsMoveBy = offsetToStart + _stakingConfig1.depositPeriodDuration + 1
            await network.provider.send("evm_increaseTime", [tsMoveBy]);
            await network.provider.send("evm_mine");
            // update should revert
            await expect(
                _staking.connect(_owner)
                    .functions.updateStakingConfig(stakingKey, newTokensForRewards)
            ).to.be.rejectedWith(
                revertMsg("to update, config can only be PreOpened or Opened")
            )
        })
    it(
        "[borderCase] should revert if config is Completed",
        async function () {
            const [stakingKey] = await _staking.functions.getConfigKey(_stakingConfig1);
            const newTokensForRewards = ethers.utils.parseEther("5").toString()
            // set config
            await _staking.connect(_owner)
                .functions.setStakingConfig(_stakingConfig1)

            // complete config by moving the timestamp of the blockchain
            // move block timestamp to 
            // startDate+depositPeriodDuration+lockPeriodDuration+1
            let block = await ethers.provider.getBlock("latest");
            let offsetToStart = _stakingConfig1.startDate - block.timestamp
            let tsMoveBy = offsetToStart + _stakingConfig1.depositPeriodDuration + 
                            _stakingConfig1.lockPeriodDuration + 1
            await network.provider.send("evm_increaseTime", [tsMoveBy]);
            await network.provider.send("evm_mine");
            // update should revert since it is closed
            await expect(
                _staking.connect(_owner)
                    .functions.updateStakingConfig(stakingKey, newTokensForRewards)
            ).to.be.rejectedWith(
                revertMsg("to update, config can only be PreOpened or Opened")
            )
        })
    it(
        "[borderCase] should revert if config is Completed",
        async function () {
            const [stakingKey] = await _staking.functions.getConfigKey(_stakingConfig1);
            const newTokensForRewards = ethers.utils.parseEther("5").toString()
            // set config
            await _staking.connect(_owner)
                .functions.setStakingConfig(_stakingConfig1)

            // check that state must be PreOpened (0)
            await _staking.functions.getConfigState(stakingKey)
                .then((res) => {
                    expect(res[0]).to.equal(0)
                })
            // move block timestamp to 
            // startDate+depositPeriodDuration+1
            let block = await ethers.provider.getBlock("latest");
            let offsetToStart = _stakingConfig1.startDate - block.timestamp
            let tsMoveBy = offsetToStart + _stakingConfig1.depositPeriodDuration + 1
            console.log("increase network timestamp by", tsMoveBy, "seconds");
            await network.provider.send("evm_increaseTime", [tsMoveBy]);
            await network.provider.send("evm_mine");
            // check that state must be Locked (2)
            await _staking.functions.getConfigState(stakingKey)
                .then((res) => {
                    expect(res[0]).to.equal(2)
                })
            // update should revert
            await expect(
                _staking.connect(_owner)
                    .functions.updateStakingConfig(stakingKey, newTokensForRewards)
            ).to.be.rejectedWith(
                revertMsg("to update, config can only be PreOpened or Opened")
            )
            // move the timestamp to closed
            tsMoveBy = _stakingConfig1.lockPeriodDuration;
            await network.provider.send("evm_increaseTime", [tsMoveBy]);
            await network.provider.send("evm_mine");
            // check that state must be Completed (3)
            await _staking.functions.getConfigState(stakingKey)
                .then((res) => {
                    expect(res[0]).to.equal(3)
                })
            // update should revert
            await expect(
                _staking.connect(_owner)
                    .functions.updateStakingConfig(stakingKey, newTokensForRewards)
            ).to.be.rejectedWith(
                revertMsg("to update, config can only be PreOpened or Opened")
            )
        })
})