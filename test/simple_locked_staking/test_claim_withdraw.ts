import { ethers, network } from "hardhat";
import { expect } from "chai";

let stakingToken, rewardToken, simpleStaking;
let owner, addr1, addr2, addr3;
const oneDay = 86400;

beforeEach(async () => {
    // Get the ContractFactories
    const Token = await ethers.getContractFactory("DobToken");
    const SimpleLockedStaking = await ethers.getContractFactory("SimpleLockedStaking");

    // Deploy staking and reward tokens
    stakingToken = await Token.deploy("StakingToken", "STK");
    rewardToken = await Token.deploy("RewardToken", "RWD");

    // Get signers
    [owner, addr1, addr2, addr3] = await ethers.getSigners();

    // Deploy SimpleLockedStaking contract
    simpleStaking = await SimpleLockedStaking.connect(owner).deploy(stakingToken.address, rewardToken.address);


    // mint tokens
    await rewardToken.mint_supply(owner.address, ethers.utils.parseUnits("100"));

    // deposit reward tokens to allow staking
    await rewardToken.transfer(simpleStaking.address, ethers.utils.parseUnits("100"))

    let block = await ethers.provider.getBlock("latest");
    await simpleStaking.connect(owner).setConfig({
        rewardRate: 1000, // 0.1
        lockDays: 7,
        depositDays: 1,
        startDate: block.timestamp + oneDay
    })

    // generate stake tokens and approves
    await stakingToken.mint_supply(addr1.address, ethers.utils.parseUnits("3000"));
    await stakingToken.connect(addr1).transfer(addr2.address, ethers.utils.parseUnits("400"))
    await stakingToken.connect(addr1).approve(simpleStaking.address, ethers.utils.parseUnits("1000"))
    await stakingToken.connect(addr2).approve(simpleStaking.address, ethers.utils.parseUnits("1000"))

    //move to state Opened
    await network.provider.send("evm_increaseTime", [oneDay + 30]);
    await network.provider.send("evm_mine");
    expect(await simpleStaking.getState()).to.equal(1)

    // do some stakes

    //addr1 stake 50 token
    await simpleStaking.connect(addr1).stake(ethers.utils.parseUnits("50"))
    //addr2 stake 200 token
    await simpleStaking.connect(addr2).stake(ethers.utils.parseUnits("200"))
    //addr2 stake 0.034 more tokens
    await simpleStaking.connect(addr2).stake(ethers.utils.parseUnits("0.034"))
    // addr1 stake 600 tokens
    await simpleStaking.connect(addr1).stake(ethers.utils.parseUnits("600"))

});

describe("Claim and withdraw Tokens", function () {
    it("should prevent claim if stake is not completed", async function(){

        await expect(
            simpleStaking.connect(addr1).claim()
        ).to.be.rejectedWith("Config state must be Completed")

        //move to state Closed
        await network.provider.send("evm_increaseTime", [oneDay * 2]);
        await network.provider.send("evm_mine");
        expect(await simpleStaking.getState()).to.equal(2)

        await expect(
            simpleStaking.connect(addr1).claim()
        ).to.be.rejectedWith("Config state must be Completed")
    });

    it("should prevent claim if no amount was staked", async function(){
        //move to state Completed
        await network.provider.send("evm_increaseTime", [oneDay * 10]);
        await network.provider.send("evm_mine");
        expect(await simpleStaking.getState()).to.equal(3)

        await expect(
            simpleStaking.connect(addr3).claim()
        ).to.be.rejectedWith("User does not have staked tokens")

    })

    it("should allow claim if user have staked tokens and state is completed", async function(){
        //move to state Completed
        await network.provider.send("evm_increaseTime", [oneDay * 10]);
        await network.provider.send("evm_mine");
        expect(await simpleStaking.getState()).to.equal(3)

        // before claim staked amount for user should be >0
        expect(
            (await simpleStaking.getUserStakedAmount(addr1.address)).toString()
        ).to.equal(ethers.utils.parseUnits("650").toString())

        // and estimated reward should be 65
        expect(
            (await simpleStaking.estimateConfigUserRewards(addr1.address)).toString()
        ).to.equal(ethers.utils.parseUnits("65").toString())

        await simpleStaking.connect(addr1).claim()

        // check usage variables
        // after claim staked amount for user should be 0
        expect(
            (await simpleStaking.getUserStakedAmount(addr1.address)).toString()
        ).to.equal("0")

        let res = await simpleStaking.getConfigUsageData()
        expect(Number(res.activeUsersCount)).to.equal(1)
        expect(
            res.totalClaimed.toString()
        ).to.equal(ethers.utils.parseUnits("65").toString())
        expect(
            res.rewardBalance.toString()
        ).to.equal(ethers.utils.parseUnits("35").toString())
        expect(
            res.totalStaked.toString()
        ).to.equal(ethers.utils.parseUnits("200.034").toString())

        // also after the claim the user balance should change
        expect(
            (await stakingToken.balanceOf(addr1.address)).toString()
        ).to.equal(ethers.utils.parseUnits("2600"))

        expect(
            (await rewardToken.balanceOf(addr1.address)).toString()
        ).to.equal(ethers.utils.parseUnits("65"))

        // and the smart contract balance should also change
        expect(
            (await stakingToken.balanceOf(simpleStaking.address)).toString()
        ).to.equal(ethers.utils.parseUnits("200.034"))

        expect(
            (await rewardToken.balanceOf(simpleStaking.address)).toString()
        ).to.equal(ethers.utils.parseUnits("35").toString())
    })
    it("should update state variables correctly if all users claim", async function(){
        //move to state Completed
        await network.provider.send("evm_increaseTime", [oneDay * 10]);
        await network.provider.send("evm_mine");
        expect(await simpleStaking.getState()).to.equal(3)

        // both users claim
        await simpleStaking.connect(addr1).claim()
        await simpleStaking.connect(addr2).claim()

        // check state variables
        let res = await simpleStaking.getConfigUsageData()
        expect(Number(res.activeUsersCount)).to.equal(0)
        expect(
            res.totalClaimed.toString()
        ).to.equal(ethers.utils.parseUnits("85.0034").toString())
        expect(
            res.rewardBalance.toString()
        ).to.equal(ethers.utils.parseUnits("14.9966").toString())
        expect(
            res.totalStaked.toString()
        ).to.equal("0")

        // check balance of both users and smart contract
        expect(
            (await stakingToken.balanceOf(addr1.address)).toString()
        ).to.equal(ethers.utils.parseUnits("2600"))
        expect(
            (await rewardToken.balanceOf(addr1.address)).toString()
        ).to.equal(ethers.utils.parseUnits("65"))

        expect(
            (await stakingToken.balanceOf(addr2.address)).toString()
        ).to.equal(ethers.utils.parseUnits("400"))
        expect(
            (await rewardToken.balanceOf(addr2.address)).toString()
        ).to.equal(ethers.utils.parseUnits("20.0034"))

        expect(
            (await stakingToken.balanceOf(simpleStaking.address)).toString()
        ).to.equal(ethers.utils.parseUnits("0"))
        expect(
            (await rewardToken.balanceOf(simpleStaking.address)).toString()
        ).to.equal(ethers.utils.parseUnits("14.9966"))

    })
    it("should allow withdraw remains after complete, even if no all user claimed", async function(){
        //move to state Completed
        await network.provider.send("evm_increaseTime", [oneDay * 10]);
        await network.provider.send("evm_mine");
        expect(await simpleStaking.getState()).to.equal(3)

        // 1 user claim
        await simpleStaking.connect(addr2).claim()
        // then owner do the withdraw remains
        await simpleStaking.connect(owner).withdrawRemains()
        // then the other user do claim
        await simpleStaking.connect(addr1).claim()

        // check variables
        let res = await simpleStaking.getConfigUsageData()
        expect(Number(res.activeUsersCount)).to.equal(0)
        expect(
            res.totalClaimed.toString()
        ).to.equal(ethers.utils.parseUnits("85.0034").toString())
        expect(
            res.rewardBalance.toString()
        ).to.equal("0")
        expect(
            res.totalStaked.toString()
        ).to.equal("0")

        // check balance of both users and smart contract
        expect(
            (await stakingToken.balanceOf(addr1.address)).toString()
        ).to.equal(ethers.utils.parseUnits("2600"))
        expect(
            (await rewardToken.balanceOf(addr1.address)).toString()
        ).to.equal(ethers.utils.parseUnits("65"))

        expect(
            (await stakingToken.balanceOf(addr2.address)).toString()
        ).to.equal(ethers.utils.parseUnits("400"))
        expect(
            (await rewardToken.balanceOf(addr2.address)).toString()
        ).to.equal(ethers.utils.parseUnits("20.0034"))

        expect(
            (await stakingToken.balanceOf(simpleStaking.address)).toString()
        ).to.equal(ethers.utils.parseUnits("0"))
        expect(
            (await rewardToken.balanceOf(simpleStaking.address)).toString()
        ).to.equal(ethers.utils.parseUnits("0"))

        expect(
            (await stakingToken.balanceOf(owner.address)).toString()
        ).to.equal(ethers.utils.parseUnits("0"))
        expect(
            (await rewardToken.balanceOf(owner.address)).toString()
        ).to.equal(ethers.utils.parseUnits("14.9966"))

    })

    it("should prevent withdraw remains if is not complete", async function(){
        await expect(
            simpleStaking.connect(owner).withdrawRemains()
        ).to.be.rejectedWith("Config state must be Completed")
    })

    it("should update the totalLockedRewards once state is locked", async function(){
        // before locked the totalLockedRewards is all
        expect(
            (await simpleStaking.getTotalLockedRewards()).toString()
        ).to.equal(ethers.utils.parseUnits("100").toString())
        
        //move to state Locked
        await network.provider.send("evm_increaseTime", [oneDay * 2]);
        await network.provider.send("evm_mine");
        expect(await simpleStaking.getState()).to.equal(2)

        expect(
            (await simpleStaking.getTotalLockedRewards()).toString()
        ).to.equal(ethers.utils.parseUnits("85.0034").toString())

        //move to state Completed
        await network.provider.send("evm_increaseTime", [oneDay * 20]);
        await network.provider.send("evm_mine");
        expect(await simpleStaking.getState()).to.equal(3)

        expect(
            (await simpleStaking.getTotalLockedRewards()).toString()
        ).to.equal(ethers.utils.parseUnits("85.0034").toString())

    })


})  