import { expect } from "chai";
import { ethers, network } from "hardhat";

let stakingToken, rewardToken, simpleStaking;
let owner, addr1, addr2;
const oneDay = 86400;

beforeEach(async () => {
    // Get the ContractFactories
    const Token = await ethers.getContractFactory("DobToken");
    const SimpleLockedStaking = await ethers.getContractFactory("SimpleLockedStaking");

    // Deploy staking and reward tokens
    stakingToken = await Token.deploy("StakingToken", "STK");
    rewardToken = await Token.deploy("RewardToken", "RWD");

    // Get signers
    [owner, addr1, addr2] = await ethers.getSigners();

    // Deploy SimpleLockedStaking contract
    simpleStaking = await SimpleLockedStaking.connect(owner).deploy(stakingToken.address, rewardToken.address);


    // mint tokens
    await stakingToken.mint_supply(addr1.address, ethers.utils.parseUnits("1000"));
    await rewardToken.mint_supply(owner.address, ethers.utils.parseUnits("1000"));

    // deposit reward tokens to allow staking
    await rewardToken.transfer(simpleStaking.address, ethers.utils.parseUnits("10"))

});

describe("Contract Deployment", function () {
    it("Should deploy the contract with correct addresses", async function () {

        expect(await simpleStaking.stakeToken()).to.equal(stakingToken.address);
        expect(await simpleStaking.rewardToken()).to.equal(rewardToken.address);
    });

    it("should allow set and get config in deployed contract", async function (){

        expect(await simpleStaking.getState()).to.equal(4); // notSet
        let block = await ethers.provider.getBlock("latest")
        await simpleStaking.connect(owner).setConfig({
            rewardRate: 1000, // 0.1
            lockDays: 7,
            depositDays: 1,
            startDate: block.timestamp + 10 // any number higher than current timestamp
        })
        expect(await simpleStaking.getState()).to.not.equal(4); // != notSet

        let config = await simpleStaking.getConfig()
        expect(Number(config["rewardRate"])).to.equal(1000)
        expect(Number(config["lockDays"])).to.equal(7)
        expect(Number(config["depositDays"])).to.equal(1)
        expect(Number(config["startDate"])).to.equal(block.timestamp + 10)

    });

    it("should change states while time is progressing", async function(){
        expect(await simpleStaking.getState()).to.equal(4); // not set

        let block = await ethers.provider.getBlock("latest");

        await simpleStaking.connect(owner).setConfig({
            rewardRate: 1000, // 0.1
            lockDays: 7,
            depositDays: 1,
            startDate: block.timestamp + oneDay
        })

        expect(await simpleStaking.getState()).to.equal(0); // pre opened
    
        // move block 1 day and 10 seconds
        await network.provider.send("evm_increaseTime", [oneDay + 10]);
        await network.provider.send("evm_mine");
        expect(await simpleStaking.getState()).to.equal(1); // opened

        // move block 1 day
        await network.provider.send("evm_increaseTime", [oneDay]);
        await network.provider.send("evm_mine");

        expect(await simpleStaking.getState()).to.equal(2); // locked

        // move block 7 day
        await network.provider.send("evm_increaseTime", [oneDay * 7]);
        await network.provider.send("evm_mine");

        expect(await simpleStaking.getState()).to.equal(3); // completed

        // move block 9999 day
        await network.provider.send("evm_increaseTime", [oneDay * 9999]);
        await network.provider.send("evm_mine");

        expect(await simpleStaking.getState()).to.equal(3); // completed
    })

    it("should estimate rewards correctly", async function(){
        let block = await ethers.provider.getBlock("latest");
        await simpleStaking.connect(owner).setConfig({
            rewardRate: 1000, // 0.1
            lockDays: 7,
            depositDays: 1,
            startDate: block.timestamp + oneDay
        })

        // for the given config, if we estimate a stake of 46313.246 tokens
        // we should get as rewards 4631.3246 tokens
        let stake = ethers.utils.parseEther("46313.246")
        let reward = ethers.utils.parseEther("4631.3246")
        expect(
            (await simpleStaking.estimateRewards(stake.toString())).toString()
        ).to.equal(reward.toString())

    })

    it("should estimate max stakes correctly", async function(){
        let block = await ethers.provider.getBlock("latest");
        await simpleStaking.connect(owner).setConfig({
            rewardRate: 1000, // 0.1
            lockDays: 7,
            depositDays: 1,
            startDate: block.timestamp + oneDay
        })

        // for the given config, if we estimate a reward of 0.0453432 tokens
        // we should get as  max stake of 0.453432 tokens
        let stake = ethers.utils.parseEther("0.453432")
        let reward = ethers.utils.parseEther("0.0453432")
        expect(
            (await simpleStaking.estimateStake(reward.toString())).toString()
        ).to.equal(stake.toString())

    })

    it("should return the current reward balance correctly", async function(){
        expect(
            (await simpleStaking.getRewardTokenBalance()).toString()
        ).to.equal((await rewardToken.balanceOf(simpleStaking.address)).toString())

        rewardToken.transfer(simpleStaking.address, ethers.utils.parseEther("45.00343012"))

        expect(
            (await simpleStaking.getRewardTokenBalance()).toString()
        ).to.equal((await rewardToken.balanceOf(simpleStaking.address)).toString())
    })
});
