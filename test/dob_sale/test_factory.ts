import { expect } from "chai";
import { ethers } from "hardhat";

describe("DobSaleFactory", function () {
  let DobSaleFactory, factoryContract;
  let owner, buyer, other, other2, commissionAddress;
let DobToken, dobToken, OtherToken, otherToken;
  let DobSale, saleContract, saleContractToken;

  beforeEach(async () => {
    // Get signers
    [owner, buyer, other, other2, commissionAddress] = await ethers.getSigners();

    // Deploy the sale factory contract
    DobSaleFactory = await ethers.getContractFactory("DobSaleFactory");
    factoryContract = await DobSaleFactory.connect(owner).deploy(owner.address, 5 * 1000);
    await factoryContract.deployed();

    // Deploy the mock token
    DobToken = await ethers.getContractFactory("DobToken");
    dobToken = await DobToken.connect(owner).deploy("Dob Token", "DOB");
    await dobToken.deployed();

    // Deploy an extra ERC token
    OtherToken = await ethers.getContractFactory("DobToken");
    otherToken = await OtherToken.connect(owner).deploy("Other Token", "OTR");
    await otherToken.deployed();

    // mint supply
    await dobToken.connect(owner).mint_supply(owner.address, ethers.utils.parseEther("10000"))
    await otherToken.connect(owner).mint_supply(owner.address, ethers.utils.parseEther("10000"))
  });

  it("Should deploy correctly with initial values", async () => {
    // Check the owner
    expect(await factoryContract.owner()).to.equal(owner.address);

    // Check the commission percent
    expect(await factoryContract.commissionPercentX1000()).to.equal(5 * 1000);
  });

  it("Should allow setting the commission percent", async () => {
    await factoryContract.connect(owner).setCommissionPercentX1000(10 * 1000);
    expect(await factoryContract.commissionPercentX1000()).to.equal(10 * 1000);
  });

  it("Should allow setting the commission address", async () => {
    await factoryContract.connect(owner).setCommissionAddress(other.address);
    expect(await factoryContract.commissionAddress()).to.equal(other.address);
  });

  it("Should create a new DobSale contract and a sale should work", async () => {
    let tx = await factoryContract.connect(owner).createDobSale(
        ethers.constants.AddressZero, 
        dobToken.address, 
        ethers.utils.parseEther("0.01")
    );
    let receipt = await tx.wait();

    // Get the sale contract address
    let saleAddress = receipt.events[0].address;
    DobSale = await ethers.getContractFactory("DobSale");
    saleContract = await DobSale.attach(saleAddress);

    // add allowance to sell
    await dobToken.connect(owner).approve(saleContract.address, ethers.utils.parseEther("10000"));

    // check allowance
    console.log("allowance", await dobToken.allowance(owner.address, saleContract.address))
    expect(await dobToken.allowance(owner.address, saleContract.address)).to.equal(ethers.utils.parseEther("10000"));

    // buy some
    console.log("buy some")
    await saleContract.connect(buyer).buyToken(ethers.utils.parseEther("1"), {value: ethers.utils.parseEther("0.01")});
  });
});
