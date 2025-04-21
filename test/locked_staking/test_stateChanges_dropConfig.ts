import { ethers, network } from "hardhat";
import { expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployExternalToken, deployLockedStaking } from "../utils/deploys";
import { Contract, Signer, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { 
    revertMsg, 
    StakingConfig, 
    getDPR, 
    newConfig, 
    oneDay, 
    estimateConfigState 
} from "./utils";

describe("TEST state changes and dropConfig() function interactions", function () {
    let accounts: SignerWithAddress[];
    let _owner: Signer;
    let _staking: Contract;
    let _token: Contract;
    let _todayEpoch: number;
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
        _todayEpoch = Math.floor(Date.now() / 1000);
        _zero = BigNumber.from(0)
        _stakingConfig1 = newConfig()
        let block = await ethers.provider.getBlock("latest");
        _stakingConfig1.startDate = block.timestamp + oneDay;
    })
    it (
        "check state changes PreOpened->Opened->Locked->Completed", 
        async function(){
        // set config
        await _staking.connect(_owner)
        .functions.setStakingConfig(_stakingConfig1)
        const [stakingKey] = await _staking.functions.getConfigKey(
            _stakingConfig1);
        // check that state must be PreOpened (0)
        await _staking.functions.getConfigState(stakingKey)
        .then((res) => {
            expect(res[0]).to.equal(0)
        })
        // iterate half-daily through the blockchain for the complete
        // span of the config
        const endDate = _stakingConfig1.startDate +
        _stakingConfig1.depositPeriodDuration +
        _stakingConfig1.lockPeriodDuration +
        oneDay
        const step = Math.floor(oneDay/2);
        let block = await ethers.provider.getBlock("latest");
        let currentStepDate = block.timestamp + step;
        let counter = 0;
        while (currentStepDate < endDate) {
            await network.provider.send("evm_increaseTime", [step]);
            await network.provider.send("evm_mine");
            // check state
            await _staking.functions.getConfigState(stakingKey)
            .then((res) => {
                expect(res[0]).to.equal(
                    estimateConfigState(currentStepDate, _stakingConfig1))
            })
            // update currentStepDate
            currentStepDate += step;
            // update counter 
            counter++;
        }
        console.log("while loop had", counter, "correct iterations")
    })

    it(
        "check that an unknown config has state notSet", 
        async function(){
        const [stakingKey] = await _staking.functions.getConfigKey(
            _stakingConfig1);
        // check that state must be NotSet (5)
        await _staking.functions.getConfigState(stakingKey)
        .then((res) => {
            expect(res[0]).to.equal(5)
        })
    })

    describe("drop config tests", function(){
        it(
            "check that dropping a config set its state to Dropped", 
            async function(){
            // set config
            await _staking.connect(_owner)
                .functions.setStakingConfig(_stakingConfig1)
            const [stakingKey] = await _staking.functions.getConfigKey(
                _stakingConfig1);
    
            // drop the config
            await _staking.connect(_owner)
                .functions.dropStakingConfig(stakingKey)
            
            // check that state must be Dropped (4)
            await _staking.functions.getConfigState(stakingKey)
            .then((res) => {
                expect(res[0]).to.equal(4)
            })
        })
        it(
            "[borderCase] trying to drop a notSet config should revert", 
            async function(){
            const [stakingKey] = await _staking.functions.getConfigKey(
                _stakingConfig1);
            
            await expect(
                _staking.connect(_owner)
                    .functions.dropStakingConfig(stakingKey)
            ).to.be.rejectedWith(
                revertMsg("config not found")
            )
        })
        it(
            "[borderCase] trying to drop a dropped config should revert",
            async function(){
            const [stakingKey] = await _staking.functions.getConfigKey(
                _stakingConfig1);
            // set config
            await _staking.connect(_owner)
                .functions.setStakingConfig(_stakingConfig1)
            
            // drop the config
            await _staking.connect(_owner)
                .functions.dropStakingConfig(stakingKey)

            await expect(
                _staking.connect(_owner)
                    .functions.dropStakingConfig(stakingKey)
            ).to.be.rejectedWith(
                revertMsg("config already dropped")
            )
        })
    })
})