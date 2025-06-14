import {expect } from "chai";
import { ethers } from "hardhat";

describe("DobSale", function () {
  let owner, buyer, other, other2, commissionAddress;
  let DobToken, dobToken, OtherToken, otherToken;
  let DobSale, saleContract, saleContractToken;

  const INITIAL_PRICE = ethers.utils.parseEther("0.01"); // 0.01 ETH per full token

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
    await otherToken.connect(owner).mint_supply(owner.address, ethers.utils.parseEther("10000"))

    // Deploy the sale contract
    console.log("deploying sale contract")
    DobSale = await ethers.getContractFactory("DobSale");
    saleContract = await DobSale.connect(owner).deploy(
      ethers.constants.AddressZero,
      dobToken.address,
      INITIAL_PRICE,
      5,
      commissionAddress.address
    );
    await saleContract.deployed();

    // do allowance for sale
    console.log("allowance")
    await dobToken.connect(owner).approve(saleContract.address, ethers.utils.parseEther("10000"));
  });

  it("Should deploy correctly with initial values", async () => {
    // Check the owner
    expect(await saleContract.owner()).to.equal(owner.address);

    // Check the price
    expect(await saleContract.pricePerToken()).to.equal(INITIAL_PRICE);

    // Check the tokenDecimals (should be 18 for DobToken)
    expect(Number(await saleContract.tokenDecimals())).to.equal(18);
  });

  it("Should let a buyer purchase 1 full token with correct amount of ETH", async () => {
    // 1 full token cost:
    const cost = INITIAL_PRICE; // 0.01 ETH
    const tokenAmount = ethers.utils.parseEther("1"); // 1 full token
    console.log("current allowance", await dobToken.allowance(owner.address, saleContract.address))
    console.log("token amount to buy", tokenAmount)

    // Check buyer's initial token balance
    const initialBuyerBalance = await dobToken.balanceOf(buyer.address);
    expect(Number(initialBuyerBalance)).to.equal(0);

    // Buyer calls buyToken(1), paying 0.01 ETH
    await saleContract.connect(buyer).buyToken(tokenAmount, {
      value: cost,
    });

    // Buyer should now have exactly 1 * 10^18 tokens
    const afterBuyerBalance = await dobToken.balanceOf(buyer.address);
    expect(afterBuyerBalance).to.equal(ethers.utils.parseUnits("1", 18));
  });

  it("Should revert if buyer sends insufficient ETH", async () => {
    // cost is 0.01 ETH, let's send only 0.005 ETH
    const insufficientPayment = ethers.utils.parseEther("0.005");

    await expect(
      saleContract.connect(buyer).buyToken(ethers.utils.parseEther("1"), { value: insufficientPayment })
    ).to.be.revertedWith("Not enough currency sent");
  });

  it("Should refund excess ETH if buyer overpays", async () => {
    // cost is 0.01 ETH, let's send 0.02 ETH
    const overPayment = ethers.utils.parseEther("0.02");
    const cost = INITIAL_PRICE; // 0.01 ETH

    const buyerEthBalanceBefore = await ethers.provider.getBalance(
      buyer.address
    );

    // check the incremental variables
    expect(Number(await saleContract.totalFunds())).to.equal(0)
    expect(Number(await saleContract.totalSales())).to.equal(0)

    // Let's buy 1 token but overpay
    const tx = await saleContract.connect(buyer).buyToken(ethers.utils.parseEther("1"), {
      value: overPayment,
    });
    // check the incremental variables
    expect(await saleContract.totalFunds()).to.equal(cost)
    expect(await saleContract.totalSales()).to.equal(ethers.utils.parseUnits("1", 18))

    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

    const buyerEthBalanceAfter = await ethers.provider.getBalance(buyer.address);

    // The actual ETH spent = cost + gasUsed
    // So newBalance = oldBalance - cost - gasUsed
    const expectedBalance = buyerEthBalanceBefore.sub(cost).sub(gasUsed);

    // Allow small rounding difference, but they should be equal
    expect(buyerEthBalanceAfter).to.equal(expectedBalance);

    // Buyer should have 1 token
    const buyerTokenBalance = await dobToken.balanceOf(buyer.address);
    expect(buyerTokenBalance).to.equal(ethers.utils.parseUnits("1", 18));
  });

  it("Should revert if Not enough allowance", async () => {
    // We only allowed 10,000 tokens. Try to buy 100,000 full tokens
    await expect(
      saleContract.connect(buyer).buyToken(ethers.utils.parseEther("100000"), {
        value: ethers.utils.parseEther("1000"), // big payment
      })
    ).to.be.revertedWith("Not enough allowance");
  });

  // it("Should allow owner to withdraw collected ETH", async () => {
  //   // First, let buyer buy 2 tokens
  //   const costFor2 = INITIAL_PRICE.mul(2); // 0.02 ETH
  //   await saleContract.connect(buyer).buyToken(2, { value: costFor2 });

  //   // Check contract's balance
  //   const contractBalance = await ethers.provider.getBalance(
  //     saleContract.address
  //   );
  //   expect(contractBalance).to.equal(costFor2);

  //   // Owner withdraws
  //   const ownerEthBalanceBefore = await ethers.provider.getBalance(owner.address);
  //   const tx = await saleContract.connect(owner).withdrawFunds();
  //   const receipt = await tx.wait();
  //   const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

  //   const ownerEthBalanceAfter = await ethers.provider.getBalance(owner.address);
  //   // Owner's new balance ~ oldBalance + contractBalance - gas
  //   expect(ownerEthBalanceAfter).to.equal(
  //     ownerEthBalanceBefore.add(costFor2).sub(gasUsed)
  //   );

  //   // Contract should be zero after withdrawal
  //   const contractBalanceAfter = await ethers.provider.getBalance(
  //     saleContract.address
  //   );
  //   expect(contractBalanceAfter).to.equal(0);
  // });

  // it("Should revert if non-owner tries to withdraw ETH", async () => {
  //   await expect(saleContract.connect(buyer).withdrawFunds()).to.be.revertedWith(
  //     "Ownable: caller is not the owner"
  //   );
  // });

  // it("Should allow owner to withdraw unsold tokens", async () => {
  //   // Contract initially has 10,000 tokens
  //   const contractTokenBalance = await dobToken.balanceOf(saleContract.address);
  //   expect(contractTokenBalance).to.equal(ethers.utils.parseUnits("10000", 18));

  //   // Owner withdraws 1,000 full tokens
  //   await saleContract.connect(owner).withdrawUnsoldTokens(1000);

  //   // Contract now has 9,000 tokens
  //   const contractBalanceAfter = await dobToken.balanceOf(saleContract.address);
  //   expect(contractBalanceAfter).to.equal(ethers.utils.parseUnits("9000", 18));

  //   // Owner’s balance should have increased by 1000 tokens
  //   const ownerTokenBalance = await dobToken.balanceOf(owner.address);
  //   expect(ownerTokenBalance).to.equal(ethers.utils.parseUnits("1000", 18));
  // });

  // it("Should revert if non-owner tries to withdraw unsold tokens", async () => {
  //   await expect(
  //     saleContract.connect(buyer).withdrawUnsoldTokens(1)
  //   ).to.be.revertedWith("Ownable: caller is not the owner");
  // });

  // it("Should allow owner to set a new price", async () => {
  //   expect(await saleContract.price()).to.equal(INITIAL_PRICE);
  //   const newPrice = ethers.utils.parseEther("0.02");
  //   await saleContract.connect(owner).setPrice(newPrice);

  //   expect(await saleContract.price()).to.equal(newPrice);
  // });

  // it("Should revert if non-owner tries to set new price", async () => {
  //   await expect(
  //     saleContract.connect(buyer).setPrice(ethers.utils.parseEther("0.02"))
  //   ).to.be.revertedWith("Ownable: caller is not the owner");
  // });

  // it("Should revert if owner tries to set price to 0", async () => {
  //   await expect(saleContract.connect(owner).setPrice(0)).to.be.revertedWith(
  //     "Price must be > 0"
  //   );
  // });

  it("Should allow to transfer ownership", async () => {
    expect(await saleContract.owner()).to.equal(owner.address)
    await saleContract.connect(owner).transferOwnership(other.address)
    expect(await saleContract.owner()).to.equal(other.address)
  });

  it("should revert if non-owner tries to transfer ownership", async () => {
    await expect(
      saleContract.connect(other).transferOwnership(buyer.address)
    ).to.be.revertedWith("Ownable: caller is not the owner")
  });

  it("should allow complex interactions", async () => {
    let owner_fees = ethers.utils.parseEther("0")
    let buyer_fees = ethers.utils.parseEther("0")
    let other_fees = ethers.utils.parseEther("0")
    let tx, receipt;
    const owner_before_balance = await ethers.provider.getBalance(owner.address)
    const buyer_before_balance = await ethers.provider.getBalance(buyer.address)
    const other_before_balance = await ethers.provider.getBalance(other.address)

    // contract starts with 10000 allowance tokens, sale price is 0.01
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

    // lets buy 2000 tokens with overpay from address 'other'
    console.log("3. 'other' buys 2000 tokens")
    tx = await saleContract.connect(other).buyToken(ethers.utils.parseEther("2000"), { value: ethers.utils.parseEther("1000") })
    receipt = await tx.wait();
    other_fees = other_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))

    // lets buy the rest with address 'buyer', with exact price (400 * 0.01 = 4 eth)
    console.log("4. 'buyer' buys 400 tokens")
    tx = await saleContract.connect(buyer).buyToken(ethers.utils.parseEther("400"), { value: ethers.utils.parseEther("4") })
    receipt = await tx.wait();
    buyer_fees = buyer_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))

    // trying to buy now should revert, here we use a different address (other2) so we dont have to deal with fee lost
    console.log("5. 'other2' tries to buy 1 token (should fail")
    await expect(
      saleContract.connect(other2).buyToken(ethers.utils.parseEther("1"), { value: ethers.utils.parseEther("1") })
    ).to.be.revertedWith("Not enough allowance")

    // then approve allowance of more tokens
    console.log("6. owner approve allowance of 200 more tokens")
    tx = await dobToken.connect(owner).approve(saleContract.address, ethers.utils.parseEther("200"))
    receipt = await tx.wait();
    owner_fees = owner_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))
    expect(await dobToken.allowance(owner.address, saleContract.address)).to.equal(ethers.utils.parseEther("200"))

    // and now we should be able to buy
    console.log("7. 'other' buys 1 tokens")
    tx = await saleContract.connect(other).buyToken(ethers.utils.parseEther("1"), { value: ethers.utils.parseEther("1") })
    receipt = await tx.wait();
    other_fees = other_fees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice))

    // now check internal counter variables
    // the buyTokens() we made are:
    // 2000 tokens -> 20 eth
    // 400 tokens -> 4 eth
    // 1 token -> 0.01 eth
    console.log("-> checking variables...")
    expect(await saleContract.totalFunds()).to.equal(ethers.utils.parseEther("24.01"))
    expect(await saleContract.totalSales()).to.equal(ethers.utils.parseEther("2401"))
    expect(await saleContract.totalCommission()).to.equal(ethers.utils.parseEther("24.01").mul(5).div(100))
    expect(await saleContract.totalProfit()).to.equal(
      ethers.utils.parseEther("24.01").sub(ethers.utils.parseEther("24.01").mul(5).div(100))
    )

    // now check balances
    // buyer should have      400 tokens and spent 4 eth + fees
    // other should have      2001 tokens and spent 20.01 eth + fees
    // owner should have      7599 tokens and got 'profit' eth, minus fees spent
    // contract should have   199 tokens of allowance
    console.log("-> checking ERC20 balances...")
    expect(await dobToken.balanceOf(owner.address)).to.equal(ethers.utils.parseEther("7599"))
    expect(await dobToken.balanceOf(buyer.address)).to.equal(ethers.utils.parseEther("400"))
    expect(await dobToken.balanceOf(other.address)).to.equal(ethers.utils.parseEther("2001"))
    expect(await dobToken.allowance(owner.address, saleContract.address)).to.equal(ethers.utils.parseEther("199"))

    const owner_after_balance = await ethers.provider.getBalance(owner.address)
    const buyer_after_balance = await ethers.provider.getBalance(buyer.address)
    const other_after_balance = await ethers.provider.getBalance(other.address)
    console.log("-> checking ETH balances...")
    expect(owner_after_balance).to.equal(
      owner_before_balance.add(await saleContract.totalProfit()).sub(owner_fees)
    )

    expect(buyer_after_balance).to.equal(
      buyer_before_balance.sub(ethers.utils.parseEther("4")).sub(buyer_fees)
    )

    expect(other_after_balance).to.equal(
      other_before_balance.sub(ethers.utils.parseEther("20.01")).sub(other_fees)
    )
  })

});
