import { ethers, network } from "hardhat";
import { expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployExternalToken, deployLockedStaking } from "../utils/deploys";
import { Contract, Signer, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { revertMsg, StakingConfig, getDPR, newConfig, oneDay } from "./utils";

describe("TEST earlyWithdraw() function interactions", function () {
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
    it(
        "...",
        async function () {

        }
    )
    it(
        "[borderCase] ...",
        async function () {

        }
    )
})