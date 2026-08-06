/**
 * AUDIT 2026-08 — TokenSaleMarket findings M-2 and M-7, now inverted.
 *
 * M-2  `buyToken` paid the seller (and the commission) with
 *          `payable(_to).send(_amount)`   (2300 gas, returns bool)
 *      and IGNORED the returned bool. The token transfer had already happened,
 *      and the contract had no withdraw and no rescue — so a seller who could
 *      not take a bare 2300-gas transfer (a Safe, a vesting contract, any smart
 *      wallet) lost the payment permanently while the buyer kept the tokens.
 *      Payouts now use a full-gas `call` and the sale reverts if it fails, and
 *      `rescueNative` recovers anything already stranded.
 *
 * M-7  `updateFee(uint256)` had no upper bound, so the owner could take 100 %
 *      of every commissioned sale, or brick the market entirely with a value
 *      above 10000. It is now capped at MAX_FEE_BPS (10 %).
 */
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployStorage, deployTokenSaleMarket, deployExternalToken } from "../utils/deploys";

describe("AUDIT 2026-08 / TokenSaleMarket", function () {
    let accounts: SignerWithAddress[];
    let creator: SignerWithAddress;
    let marketOwner: SignerWithAddress;
    let seller: SignerWithAddress;
    let buyer: SignerWithAddress;

    let _storage: Contract;
    let _tsmLogic: Contract;
    let _tsmProxy: Contract;
    let tsm: Contract;          // logic ABI attached to the proxy
    let token: Contract;

    const price = ethers.utils.parseEther("1");   // 1 ETH per minDivision
    const minDivision = 100;

    async function deployMarket(commissionBps: number) {
        [_tsmLogic, _tsmProxy] = await deployTokenSaleMarket(
            creator, marketOwner, _storage, commissionBps
        );
        tsm = _tsmLogic.attach(_tsmProxy.address);
    }

    beforeEach(async function () {
        accounts = await ethers.getSigners();
        creator = accounts[0];
        marketOwner = accounts[1];
        seller = accounts[2];
        buyer = accounts[3];

        _storage = await deployStorage(creator);
        token = await deployExternalToken(creator, "Shares", "SHR", "1000000");
    });

    it("M-2: a seller that cannot receive ETH makes the sale revert instead of eating the payment", async function () {
        await deployMarket(0);   // no commission — isolate the seller payment

        // The seller is a contract with no `receive`. It holds the shares and
        // configures its own sale through the market, exactly like an EOA would.
        const Mock = await ethers.getContractFactory("AuditNonPayableSeller");
        const contractSeller = await Mock.connect(seller).deploy();
        await token.connect(creator).transfer(contractSeller.address, 1000);

        const approveData = token.interface.encodeFunctionData(
            "approve", [tsm.address, 1000]
        );
        await contractSeller.connect(seller).forward(token.address, approveData);

        const saleData = tsm.interface.encodeFunctionData(
            "setSaleProperties", [token.address, price, minDivision]
        );
        await contractSeller.connect(seller).forward(tsm.address, saleData);

        // The buy now fails as a whole rather than half-executing.
        await expect(
            tsm.connect(buyer).functions.buyToken(
                minDivision, contractSeller.address, token.address, { value: price }
            )
        ).to.be.revertedWith("NATIVE_TRANSFER_FAILED");

        // Nothing moved: the buyer keeps their ETH, the seller keeps the shares,
        // and no ETH is left behind in the market.
        expect(await token.balanceOf(buyer.address)).to.equal(0);
        expect(await token.balanceOf(contractSeller.address)).to.equal(1000);
        expect(await ethers.provider.getBalance(tsm.address)).to.equal(0);
    });

    it("M-2: a seller that needs more than the 2300-gas stipend now gets paid", async function () {
        await deployMarket(0);

        // This receiver writes a storage slot on receipt — impossible under
        // `send`, routine under a full-gas `call`. Smart-contract wallets look
        // like this, so the old code failed for a large class of real sellers.
        const Hungry = await ethers.getContractFactory("GasHungryReceiver");
        const contractSeller = await Hungry.connect(seller).deploy();
        await token.connect(creator).transfer(contractSeller.address, 1000);

        await contractSeller.connect(seller).forward(
            token.address,
            token.interface.encodeFunctionData("approve", [tsm.address, 1000])
        );
        await contractSeller.connect(seller).forward(
            tsm.address,
            tsm.interface.encodeFunctionData(
                "setSaleProperties", [token.address, price, minDivision]
            )
        );

        await tsm.connect(buyer).functions.buyToken(
            minDivision, contractSeller.address, token.address, { value: price }
        );

        expect(await token.balanceOf(buyer.address)).to.equal(minDivision);
        expect(await ethers.provider.getBalance(contractSeller.address)).to.equal(price);
        expect(await contractSeller.received()).to.equal(price);
        expect(await ethers.provider.getBalance(tsm.address)).to.equal(0);
    });

    it("M-2: ETH already stranded in a deployed market can be rescued", async function () {
        await deployMarket(0);

        // Recreate the pre-fix damage: force 2 ETH into the market proxy.
        const Forcer = await ethers.getContractFactory("ForceSender");
        const forcer = await Forcer.connect(creator).deploy();
        await creator.sendTransaction({
            to: forcer.address, value: ethers.utils.parseEther("2")
        });
        await forcer.connect(creator).destroy(tsm.address);
        expect(await ethers.provider.getBalance(tsm.address))
            .to.equal(ethers.utils.parseEther("2"));

        // Only the owner can pull it out.
        await expect(
            tsm.connect(buyer).functions.rescueNative(buyer.address, ethers.utils.parseEther("2"))
        ).to.be.rejected;

        const before = await ethers.provider.getBalance(seller.address);
        await tsm.connect(marketOwner).functions.rescueNative(
            seller.address, ethers.utils.parseEther("2")
        );
        expect((await ethers.provider.getBalance(seller.address)).sub(before))
            .to.equal(ethers.utils.parseEther("2"));
        expect(await ethers.provider.getBalance(tsm.address)).to.equal(0);
    });

    it("M-7: the commission is capped, at deploy time and afterwards", async function () {
        await deployMarket(300);   // a sane 3%

        await token.connect(creator).transfer(seller.address, 1000);
        await token.connect(seller).approve(tsm.address, 1000);
        await tsm.connect(seller).functions.setSaleProperties(
            token.address, price, minDivision
        );

        // Neither initialize nor updateFee will take a confiscatory fee now.
        await expect(
            deployTokenSaleMarket(creator, marketOwner, _storage, 10000)
        ).to.be.rejectedWith("FEE_ABOVE_MAX");
        await expect(
            tsm.connect(marketOwner).functions.updateFee(10000)
        ).to.be.rejectedWith("FEE_ABOVE_MAX");
        await expect(
            tsm.connect(marketOwner).functions.updateFee(10001)
        ).to.be.rejectedWith("FEE_ABOVE_MAX");
        await expect(
            tsm.connect(marketOwner).functions.updateFee(1001)
        ).to.be.rejectedWith("FEE_ABOVE_MAX");

        // The ceiling itself is usable, and the seller still gets 90%.
        await tsm.connect(marketOwner).functions.updateFee(1000);
        const sellerBefore = await ethers.provider.getBalance(seller.address);
        const ownerBefore = await ethers.provider.getBalance(marketOwner.address);

        await tsm.connect(buyer).functions.buyToken(
            minDivision, seller.address, token.address, { value: price }
        );

        expect(await token.balanceOf(buyer.address)).to.equal(minDivision);
        expect((await ethers.provider.getBalance(seller.address)).sub(sellerBefore))
            .to.equal(price.mul(9000).div(10000));
        expect((await ethers.provider.getBalance(marketOwner.address)).sub(ownerBefore))
            .to.equal(price.mul(1000).div(10000));
    });
});
