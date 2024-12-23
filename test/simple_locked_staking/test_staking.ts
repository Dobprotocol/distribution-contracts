import { ethers, network } from "hardhat";
import { expect } from "chai";

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
    await rewardToken.mint_supply(owner.address, ethers.utils.parseUnits("1000"));

    // deposit reward tokens to allow staking
    await rewardToken.transfer(simpleStaking.address, ethers.utils.parseUnits("100"))

    let block = await ethers.provider.getBlock("latest");
    await simpleStaking.connect(owner).setConfig({
        rewardRate: 1000, // 0.1
        lockDays: 7,
        depositDays: 1,
        startDate: block.timestamp + oneDay
    })


});

describe("Staking Tokens", function () {
    it("Should allow users to stake tokens when state is Opened", async function () {
        // move the state to opened
        await network.provider.send("evm_increaseTime", [oneDay + 10]);
        await network.provider.send("evm_mine");

        // Check balances after staking
        const stakedAmountPre = await simpleStaking.getUserStakedAmount(addr1.address);
        expect(stakedAmountPre.toString()).to.equal("0");

        // Setup staking configuration
        await stakingToken.mint_supply(addr1.address, ethers.utils.parseUnits("1000"));
        await stakingToken.connect(addr1).approve(simpleStaking.address, ethers.utils.parseUnits("100"));

        // Stake tokens
        await simpleStaking.connect(addr1).stake(ethers.utils.parseUnits("100"));

        // Check balances after staking
        const stakedAmount = await simpleStaking.getUserStakedAmount(addr1.address);
        expect(stakedAmount.toString()).to.equal(ethers.utils.parseUnits("100").toString());

        let res = await simpleStaking.getConfigUsageData()
        expect(Number(res.activeUsersCount)).to.equal(1)
        expect(Number(res.totalClaimed)).to.equal(0)
        expect(res.rewardBalance.toString()).to.equal(ethers.utils.parseUnits("100").toString())
        expect(res.totalStaked.toString()).to.equal(ethers.utils.parseUnits("100").toString())
    
    });

    it("Should prevent users to stake tokens when state is not Opened", async function(){
        // Setup staking configuration
        await stakingToken.mint_supply(addr1.address, ethers.utils.parseUnits("1000"));
        await stakingToken.connect(addr1).approve(simpleStaking.address, ethers.utils.parseUnits("100"));

        expect(await simpleStaking.getState()).to.equal(0)
        await expect(
            simpleStaking.connect(addr1).stake(ethers.utils.parseUnits("100"))
        ).to.be.rejectedWith("Config state must be Opened");

        // move to state locked
        await network.provider.send("evm_increaseTime", [oneDay * 3]);
        await network.provider.send("evm_mine");

        expect(await simpleStaking.getState()).to.equal(2)
        await expect(
            simpleStaking.connect(addr1).stake(ethers.utils.parseUnits("100"))
        ).to.be.rejectedWith("Config state must be Opened");


        // move to state completed

        await network.provider.send("evm_increaseTime", [oneDay * 10]);
        await network.provider.send("evm_mine");

        expect(await simpleStaking.getState()).to.equal(3)
        await expect(
            simpleStaking.connect(addr1).stake(ethers.utils.parseUnits("100"))
        ).to.be.rejectedWith("Config state must be Opened");


    })

    it("Should revert if staking amount exceeds the max stake", async function () {
        await stakingToken.mint_supply(addr1.address, ethers.utils.parseUnits("3000"));
        await stakingToken.connect(addr1).approve(simpleStaking.address, ethers.utils.parseUnits("3000"));

        // move to state Opened

        await network.provider.send("evm_increaseTime", [oneDay + 30]);
        await network.provider.send("evm_mine");
        expect(await simpleStaking.getState()).to.equal(1)

        // Try staking too much
        await expect(
            simpleStaking.connect(addr1).stake(ethers.utils.parseUnits("3000"))
        ).to.be.rejectedWith("cannot stake more than the allowed amount");
    });

    it("should rever if staking amount exceeds the allowance", async function (){
        await stakingToken.mint_supply(addr1.address, ethers.utils.parseUnits("3000"));
        // smaller allowance
        await stakingToken.connect(addr1).approve(simpleStaking.address, ethers.utils.parseUnits("3"));

        // move to state Opened

        await network.provider.send("evm_increaseTime", [oneDay + 30]);
        await network.provider.send("evm_mine");
        expect(await simpleStaking.getState()).to.equal(1)

        // Try staking more than allowance
        await expect(
            simpleStaking.connect(addr1).stake(ethers.utils.parseUnits("4"))
        ).to.be.rejectedWith("ERC20: insufficient allowance");
    })

    it("should allow multiples stake() calls if everything is correct", async function(){
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

        // check totals
        expect(
            (await simpleStaking.getUserStakedAmount(addr1.address)).toString()
        ).to.equal(ethers.utils.parseUnits("650").toString());
        expect(
            (await simpleStaking.getUserStakedAmount(addr2.address)).toString()
        ).to.equal(ethers.utils.parseUnits("200.034").toString());

        let res = await simpleStaking.getConfigUsageData()
        expect(Number(res.activeUsersCount)).to.equal(2)
        expect(Number(res.totalClaimed)).to.equal(0)
        expect(
            res.rewardBalance.toString()
        ).to.equal(ethers.utils.parseUnits("100").toString())
        expect(
            res.totalStaked.toString()
        ).to.equal(ethers.utils.parseUnits("850.034").toString())

        // before locked state, the locked rewards should be all
        expect(
            (await simpleStaking.getTotalLockedRewards()).toString()
        ).to.equal(ethers.utils.parseUnits("100").toString())
        
        // move to locked
        await network.provider.send("evm_increaseTime", [oneDay * 2]);
        await network.provider.send("evm_mine");
        expect(await simpleStaking.getState()).to.equal(2)

        // after move to locked state, the locked rewards should adjust
        expect(
            (await simpleStaking.getTotalLockedRewards()).toString()
        ).to.equal(ethers.utils.parseUnits("85.0034").toString())

    })
});
