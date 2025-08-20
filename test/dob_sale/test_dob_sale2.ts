import { ethers } from "hardhat";
import {expect } from "chai";

describe("DobSale ERC20 payment and extra border cases", function () {
  let owner, buyer, other, other2, commissionAddress;
  let DobToken, dobToken, OtherToken, otherToken;
  let DobSale, saleContract, saleContractToken;

  const INITIAL_PRICE = ethers.utils.parseEther("0.05"); // 0.05 PaymentToken per full token

  beforeEach(async () => {
    // Get signers
    [owner, buyer, other, other2, commissionAddress] = await ethers.getSigners();

    // Deploy the mock token
    DobToken = await ethers.getContractFactory("DobToken");
    dobToken = await DobToken.connect(owner).deploy("Dob Token", "DOB");
    await dobToken.deployed();

    // Deploy an extra ERC token
    OtherToken = await ethers.getContractFactory("DobToken");
    otherToken = await OtherToken.connect(owner).deploy("Other Token", "OTR");
    await otherToken.deployed();

    console.log("minting supply")
    // mint supply
    await dobToken.connect(owner).mint_supply(owner.address, ethers.utils.parseEther("10000"))
    await otherToken.connect(owner).mint_supply(owner.address, ethers.utils.parseEther("100000"))

    // Deploy the sale contract
    console.log("deploying sale contract")
    DobSale = await ethers.getContractFactory("DobSale");
    saleContract = await DobSale.connect(owner).deploy(
      otherToken.address,
      dobToken.address,
      INITIAL_PRICE,
      5 * 1000,
      commissionAddress.address
    );
    await saleContract.deployed();

    // do allowance for sale
    console.log("allowance")
    await dobToken.connect(owner).approve(saleContract.address, ethers.utils.parseEther("10000"));

    // transfer payment tokens to buyer, other and other2
    await otherToken.connect(owner).transfer(buyer.address, ethers.utils.parseEther("10000"));
    await otherToken.connect(owner).transfer(other.address, ethers.utils.parseEther("10000"));
    await otherToken.connect(owner).transfer(other2.address, ethers.utils.parseEther("10000"));
  });

  it("Should deploy correctly with initial values", async () => {
    // Check the owner
    expect(await saleContract.owner()).to.equal(owner.address);

    // Check the price
    expect(await saleContract.pricePerToken()).to.equal(INITIAL_PRICE);

    // Check the tokenDecimals (should be 18 for DobToken)
    expect(Number(await saleContract.tokenDecimals())).to.equal(18);

    // check payment token
    expect(await saleContract.paymentToken()).to.equal(otherToken.address);
  });

  it("Should let a buyer purchase 1 full token with correct amount of ERC20", async () => {
    const tokenAmount = ethers.utils.parseEther("1"); // 1 full token

    // approve the allowance to contract to perform buy
    console.log("estimatePAyment", await saleContract.connect(buyer).estimatePayment(tokenAmount))
    await otherToken.connect(buyer).approve(saleContract.address, await saleContract.connect(buyer).estimatePayment(tokenAmount));

    // Check buyer's initial token balance
    const initialBuyerBalance = await dobToken.balanceOf(buyer.address);
    expect(Number(initialBuyerBalance)).to.equal(0);

    // Buyer calls buyToken(1), paying 0.05 PaymentToken
    await saleContract.connect(buyer).buyToken(tokenAmount);

    // Buyer should now have exactly 1 * 10^18 sale tokens and spent 0.05 paymentToken
    const afterBuyerBalance = await dobToken.balanceOf(buyer.address);
    expect(afterBuyerBalance).to.equal(ethers.utils.parseUnits("1", 18));
    expect(await otherToken.balanceOf(buyer.address)).to.equal(ethers.utils.parseUnits("10000", 18).sub(INITIAL_PRICE));
  });

  it("Should revert if buyer approve insufficient PaymentToken", async () => {
    // lets try to buy 2 tokens but approve for 1 token
    await otherToken.connect(buyer).approve(
        saleContract.address, 
        await saleContract.connect(buyer).estimatePayment(ethers.utils.parseEther("1"))
    );

    await expect(
      saleContract.connect(buyer).buyToken(ethers.utils.parseEther("2"))
    ).to.be.revertedWith("Not enough allowance");
  });

  it("should revert is trying to pay with more than balance tokens", async () => {
    // first transfer 9999 out of the 10000 paymentTokens owned by buyer
    await otherToken.connect(buyer).transfer(other2.address, ethers.utils.parseEther("9999"));
    // then try to buy 20.1 tokens (equivalent to 1.005 payment tokens)
    await otherToken.connect(buyer).approve(
        saleContract.address, 
        await saleContract.connect(buyer).estimatePayment(ethers.utils.parseEther("20.1"))
    );

    //check contract state before
    expect(await saleContract.totalFunds()).to.equal(ethers.utils.parseEther("0"))
    expect(await saleContract.totalSales()).to.equal(ethers.utils.parseEther("0"))
    expect(await saleContract.totalCommission()).to.equal(ethers.utils.parseEther("0"))
    expect(await saleContract.totalProfit()).to.equal(ethers.utils.parseEther("0"))
    // check tokens balance state before
    expect(await dobToken.balanceOf(owner.address)).to.equal(ethers.utils.parseEther("10000"))
    expect(await otherToken.balanceOf(owner.address)).to.equal(ethers.utils.parseEther("70000"))
    expect(await dobToken.balanceOf(buyer.address)).to.equal(ethers.utils.parseEther("0"))
    expect(await otherToken.balanceOf(buyer.address)).to.equal(ethers.utils.parseEther("1"))

    await expect(
      saleContract.connect(buyer).buyToken(ethers.utils.parseEther("20.1"))
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

    //check contract state after
    expect(await saleContract.totalFunds()).to.equal(ethers.utils.parseEther("0"))
    expect(await saleContract.totalSales()).to.equal(ethers.utils.parseEther("0"))
    expect(await saleContract.totalCommission()).to.equal(ethers.utils.parseEther("0"))
    expect(await saleContract.totalProfit()).to.equal(ethers.utils.parseEther("0"))
    // check tokens balance state after
    expect(await dobToken.balanceOf(owner.address)).to.equal(ethers.utils.parseEther("10000"))
    expect(await otherToken.balanceOf(owner.address)).to.equal(ethers.utils.parseEther("70000"))
    expect(await dobToken.balanceOf(buyer.address)).to.equal(ethers.utils.parseEther("0"))
    expect(await otherToken.balanceOf(buyer.address)).to.equal(ethers.utils.parseEther("1"))
  })

  it("should allow complex interactions", async () => {
    let owner_fees = ethers.utils.parseEther("0")
    let buyer_fees = ethers.utils.parseEther("0")
    let other_fees = ethers.utils.parseEther("0")
    let tx, receipt;
    const owner_before_balance = await ethers.provider.getBalance(owner.address)
    const buyer_before_balance = await ethers.provider.getBalance(buyer.address)
    const other_before_balance = await ethers.provider.getBalance(other.address)

    // contract starts with 10000 allowance tokens, sale price is 0.05
    // owner remove allowance
    expect(await dobToken.allowance(owner.address, saleContract.address)).to.equal(ethers.utils.parseEther("10000"))
    console.log("1. owner remove allowance of tokens")
    tx = await dobToken.connect(owner).approve(saleContract.address, 0)
    receipt = await tx.wait();
    const fees = receipt.gasUsed.mul(receipt.effectiveGasPrice)
    owner_fees = owner_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))
    expect(await dobToken.allowance(owner.address, saleContract.address)).to.equal(ethers.utils.parseEther("0"))

    // then approve allowance of only 2400 tokens
    console.log("2. owner approve allowance of 2400 tokens")
    tx = await dobToken.connect(owner).approve(saleContract.address, ethers.utils.parseEther("2400"))
    receipt = await tx.wait();
    owner_fees = owner_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))
    expect(await dobToken.allowance(owner.address, saleContract.address)).to.equal(ethers.utils.parseEther("2400"))

    // lets buy 2000 tokens with over-approved allowance from address 'other'
    console.log("3. 'other' buys 2000 tokens")
    tx = await otherToken.connect(other).approve(
        saleContract.address, 
        await saleContract.connect(other).estimatePayment(ethers.utils.parseEther("5000"))
    );
    receipt = await tx.wait();
    other_fees = other_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))

    tx = await saleContract.connect(other).buyToken(ethers.utils.parseEther("2000"))
    receipt = await tx.wait();
    other_fees = other_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))

    // lets buy the rest with address 'buyer', with exact price (400 * 0.05 = 20 paymentToken)
    console.log("4. 'buyer' buys 400 tokens")
    tx = await otherToken.connect(buyer).approve(
        saleContract.address, 
        await saleContract.connect(buyer).estimatePayment(ethers.utils.parseEther("400"))
    );
    receipt = await tx.wait();
    buyer_fees = buyer_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))

    tx = await saleContract.connect(buyer).buyToken(ethers.utils.parseEther("400"))
    receipt = await tx.wait();
    buyer_fees = buyer_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))

    // trying to buy now should revert, here we use a different address (other2) so we dont have to deal with fee lost
    console.log("5. 'other2' tries to buy 1 token (should fail")
    await otherToken.connect(other2).approve(
        saleContract.address, 
        await saleContract.connect(other2).estimatePayment(ethers.utils.parseEther("1"))
    );
    await expect(
      saleContract.connect(other2).buyToken(ethers.utils.parseEther("1"))
    ).to.be.revertedWith("Not enough allowance")

    // then approve allowance of more tokens
    console.log("6. owner approve allowance of 200 more tokens")
    tx = await dobToken.connect(owner).approve(saleContract.address, ethers.utils.parseEther("200"))
    receipt = await tx.wait();
    owner_fees = owner_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))
    expect(await dobToken.allowance(owner.address, saleContract.address)).to.equal(ethers.utils.parseEther("200"))

    // and now we should be able to buy more
    console.log("7. 'other' buys 1 tokens")
    tx = await otherToken.connect(other).approve(
        saleContract.address, 
        await saleContract.connect(other).estimatePayment(ethers.utils.parseEther("1"))
    );
    receipt = await tx.wait();
    other_fees = other_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))

    tx = await saleContract.connect(other).buyToken(ethers.utils.parseEther("1"))
    receipt = await tx.wait();
    other_fees = other_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))

    // now check internal counter variables
    // the buyTokens() we made are:
    // 2000 tokens -> 100 eth
    // 400 tokens -> 20 eth
    // 1 token -> 0.05 eth
    console.log("-> checking variables...")
    expect(await saleContract.totalFunds()).to.equal(ethers.utils.parseEther("120.05"))
    expect(await saleContract.totalSales()).to.equal(ethers.utils.parseEther("2401"))
    expect(await saleContract.totalCommission()).to.equal(ethers.utils.parseEther("120.05").mul(5).div(100))
    expect(await saleContract.totalProfit()).to.equal(
      ethers.utils.parseEther("120.05").sub(ethers.utils.parseEther("120.05").mul(5).div(100))
    )

    // now check balances
    // buyer should have      400 tokens and spent 20 paymentToken, -fees in currency
    // other should have      2001 tokens and spent 100.05 paymentTokens, -fees in currency
    // owner should have      7599 tokens and got 'profit' paymentToken, -fees in currency
    // contract should have   199 tokens of allowance
    console.log("-> checking ERC20 sale balances...")
    expect(await dobToken.balanceOf(owner.address)).to.equal(ethers.utils.parseEther("7599"))
    expect(await dobToken.balanceOf(buyer.address)).to.equal(ethers.utils.parseEther("400"))
    expect(await dobToken.balanceOf(other.address)).to.equal(ethers.utils.parseEther("2001"))
    expect(await dobToken.allowance(owner.address, saleContract.address)).to.equal(ethers.utils.parseEther("199"))

    console.log("-> checking ERC20 payment balances...")
    expect(await otherToken.balanceOf(owner.address)).to.equal(
        ethers.utils.parseEther("70000").add(await saleContract.totalProfit())
    )
    expect(await otherToken.balanceOf(buyer.address)).to.equal(
        ethers.utils.parseEther("10000").sub(ethers.utils.parseEther("20"))
    )
    expect(await otherToken.balanceOf(other.address)).to.equal(
        ethers.utils.parseEther("10000").sub(ethers.utils.parseEther("100.05"))
    )

    const owner_after_balance = await ethers.provider.getBalance(owner.address)
    const buyer_after_balance = await ethers.provider.getBalance(buyer.address)
    const other_after_balance = await ethers.provider.getBalance(other.address)
    console.log("-> checking ETH balances...")
    expect(owner_after_balance).to.equal(
      owner_before_balance.sub(owner_fees)
    )

    expect(buyer_after_balance).to.equal(
      buyer_before_balance.sub(buyer_fees)
    )

    expect(other_after_balance).to.equal(
      other_before_balance.sub(other_fees)
    )
  });

  it("should revert if creating a sale with invalid payment erc address", async function () {

    await expect(
      DobSale.connect(owner).deploy(
        other2.address,  // use a wallet address instead of an ERC20 address
        dobToken.address,
        INITIAL_PRICE,
        5 * 1000,
        commissionAddress.address
        )
    ).to.be.revertedWith("paymentToken address must be 0x0 or a valid contract")
    // await saleContract2.deployed();
  });
});