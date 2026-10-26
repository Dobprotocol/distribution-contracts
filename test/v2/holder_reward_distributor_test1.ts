import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract } from "ethers";
import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";

const parseEther = ethers.utils.parseEther;
const DAY = 24 * 3600;
const ZERO = ethers.constants.AddressZero;

async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
}

// OpenZeppelin StandardMerkleTree encoding, the same one the back-end builds:
// leaf = keccak(keccak(abi.encode(account, amount))), pairs hashed sorted.
function leafOf(account: string, amount: BigNumber): string {
    const inner = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [account, amount])
    );
    return ethers.utils.keccak256(inner);
}
function hashPair(a: string, b: string): string {
    const [x, y] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    return ethers.utils.keccak256(ethers.utils.concat([x, y]));
}
function buildTree(entries: { account: string; amount: BigNumber }[]) {
    const leaves = entries.map((e) => leafOf(e.account, e.amount)).sort();
    const layers: string[][] = [leaves];
    while (layers[layers.length - 1].length > 1) {
        const prev = layers[layers.length - 1];
        const next: string[] = [];
        for (let i = 0; i < prev.length; i += 2) {
            next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
        }
        layers.push(next);
    }
    const root = layers[layers.length - 1][0];
    const proof = (account: string, amount: BigNumber) => {
        let idx = layers[0].indexOf(leafOf(account, amount));
        if (idx < 0) throw new Error("not in tree");
        const out: string[] = [];
        for (let l = 0; l < layers.length - 1; l++) {
            const sib = idx ^ 1;
            if (sib < layers[l].length) out.push(layers[l][sib]);
            idx = Math.floor(idx / 2);
        }
        return out;
    };
    return { root, proof };
}

describe("HolderRewardDistributor — pay the holders of a token that already exists", function () {
    let owner: SignerWithAddress;
    let treasury: SignerWithAddress;
    let creator: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let carol: SignerWithAddress;
    let stranger: SignerWithAddress;

    let dist: Contract;
    let reward: Contract;
    let holderToken: Contract;

    const FUNDED = parseEther("1000");
    const FEE_BPS = 50;
    const NET = FUNDED.sub(FUNDED.mul(FEE_BPS).div(10000)); // 995
    let entries: { account: string; amount: BigNumber }[];
    let tree: ReturnType<typeof buildTree>;

    let snapshotId: string;
    afterEach(async function () {
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    async function params(overrides: any = {}) {
        const head = await ethers.provider.getBlockNumber();
        return {
            rewardToken: reward.address,
            holderToken: holderToken.address,
            amount: FUNDED,
            allocated: NET,
            merkleRoot: tree.root,
            snapshotFromBlock: Math.max(0, head - 10),
            snapshotToBlock: head,
            claimDelay: 0,
            duration: 90 * DAY,
            treeUri: "https://home.dobprotocol.com/api/holder-rewards/tree/0",
            ...overrides,
        };
    }

    async function fundedRound(overrides: any = {}) {
        await reward.connect(creator).approve(dist.address, FUNDED);
        await dist.connect(creator).createRound(await params(overrides));
        return (await dist.roundCount()).sub(1);
    }

    beforeEach(async function () {
        snapshotId = await ethers.provider.send("evm_snapshot", []);
        [owner, treasury, creator, alice, bob, carol, stranger] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("TestToken");
        reward = await Token.connect(creator).deploy("Reward", "RWD", parseEther("1000000"));
        holderToken = await Token.connect(owner).deploy("Meme", "MEME", parseEther("1000000"));
        const D = await ethers.getContractFactory("HolderRewardDistributor");
        dist = await D.deploy(owner.address, treasury.address, FEE_BPS);

        // 995 split 500 / 300 / 195 — sums exactly to the net.
        entries = [
            { account: alice.address, amount: parseEther("500") },
            { account: bob.address, amount: parseEther("300") },
            { account: carol.address, amount: parseEther("195") },
        ];
        tree = buildTree(entries);
    });

    describe("createRound", function () {
        it("pulls the funding, pays the fee once and records the net", async function () {
            await reward.connect(creator).approve(dist.address, FUNDED);
            const p = await params();
            await expect(dist.connect(creator).createRound(p))
                .to.emit(dist, "RoundCreated")
                .and.to.emit(dist, "RoundTree")
                .withArgs(0, p.snapshotFromBlock, p.snapshotToBlock, p.treeUri);
            expect(await reward.balanceOf(treasury.address)).to.equal(FUNDED.sub(NET));
            expect(await reward.balanceOf(dist.address)).to.equal(NET);
            const r = await dist.getRound(0);
            expect(r.totalAmount).to.equal(NET);
            expect(r.creator).to.equal(creator.address);
            expect(r.holderToken).to.equal(holderToken.address);
            expect(r.merkleRoot).to.equal(tree.root);
        });

        it("refuses a tree that promises more than the round holds after the fee", async function () {
            await reward.connect(creator).approve(dist.address, FUNDED);
            await expect(dist.connect(creator).createRound(await params({ allocated: FUNDED })))
                .to.be.revertedWithCustomError(dist, "AllocationExceedsFunding");
        });

        it("refuses a fee-on-transfer reward token", async function () {
            const F = await ethers.getContractFactory("FeeOnTransferToken");
            const fot = await F.connect(creator).deploy(parseEther("10000"));
            await fot.connect(creator).approve(dist.address, FUNDED);
            await expect(dist.connect(creator).createRound(await params({ rewardToken: fot.address })))
                .to.be.revertedWithCustomError(dist, "TransferAmountMismatch");
        });

        it("validates root, duration, delay and snapshot window", async function () {
            await reward.connect(creator).approve(dist.address, FUNDED);
            const head = await ethers.provider.getBlockNumber();
            await expect(dist.connect(creator).createRound(await params({ merkleRoot: ethers.constants.HashZero })))
                .to.be.revertedWithCustomError(dist, "ZeroRoot");
            await expect(dist.connect(creator).createRound(await params({ duration: 29 * DAY })))
                .to.be.revertedWithCustomError(dist, "InvalidDuration");
            await expect(dist.connect(creator).createRound(await params({ claimDelay: 31 * DAY })))
                .to.be.revertedWithCustomError(dist, "InvalidClaimDelay");
            await expect(dist.connect(creator).createRound(await params({ snapshotToBlock: head + 100 })))
                .to.be.revertedWithCustomError(dist, "InvalidSnapshotWindow");
            await expect(dist.connect(creator).createRound(await params({ rewardToken: ZERO })))
                .to.be.revertedWithCustomError(dist, "ZeroAddress");
        });

        it("takes no fee when the recipient is unset", async function () {
            await dist.connect(owner).setFee(ZERO, 0);
            await fundedRound({ allocated: FUNDED });
            expect((await dist.getRound(0)).totalAmount).to.equal(FUNDED);
        });
    });

    describe("claim", function () {
        it("pays every leaf exactly once, to the account in the leaf, whoever sends it", async function () {
            const id = await fundedRound();
            for (const e of entries) {
                // A stranger sends it: the money still lands on the holder.
                await expect(dist.connect(stranger).claim(id, e.account, e.amount, tree.proof(e.account, e.amount)))
                    .to.emit(dist, "Claimed")
                    .withArgs(id, e.account, e.amount, stranger.address);
                expect(await reward.balanceOf(e.account)).to.equal(e.amount);
            }
            expect(await reward.balanceOf(stranger.address)).to.equal(0);
            expect(await reward.balanceOf(dist.address)).to.equal(0);
            await expect(dist.claim(id, alice.address, entries[0].amount, tree.proof(alice.address, entries[0].amount)))
                .to.be.revertedWithCustomError(dist, "AlreadyClaimed");
        });

        it("rejects a wrong amount or someone else's proof", async function () {
            const id = await fundedRound();
            const proof = tree.proof(alice.address, entries[0].amount);
            await expect(dist.claim(id, alice.address, parseEther("501"), proof))
                .to.be.revertedWithCustomError(dist, "InvalidProof");
            await expect(dist.claim(id, stranger.address, entries[0].amount, proof))
                .to.be.revertedWithCustomError(dist, "InvalidProof");
        });

        it("canClaim agrees with claim", async function () {
            const id = await fundedRound();
            const proof = tree.proof(bob.address, entries[1].amount);
            expect(await dist.canClaim(id, bob.address, entries[1].amount, proof)).to.equal(true);
            expect(await dist.canClaim(id, bob.address, parseEther("1"), proof)).to.equal(false);
            await dist.claim(id, bob.address, entries[1].amount, proof);
            expect(await dist.canClaim(id, bob.address, entries[1].amount, proof)).to.equal(false);
        });

        it("respects the claim window", async function () {
            const id = await fundedRound({ claimDelay: DAY });
            const proof = tree.proof(alice.address, entries[0].amount);
            await expect(dist.claim(id, alice.address, entries[0].amount, proof))
                .to.be.revertedWithCustomError(dist, "ClaimsNotOpenYet");
            await increaseTime(DAY);
            await dist.claim(id, alice.address, entries[0].amount, proof);
            await increaseTime(91 * DAY);
            await expect(dist.claim(id, bob.address, entries[1].amount, tree.proof(bob.address, entries[1].amount)))
                .to.be.revertedWithCustomError(dist, "RoundExpired");
        });

        it("a tree that overpromises cannot spend another round's funds", async function () {
            // Round 0 is honest. Round 1's tree promises 995 but the creator
            // declares 100 and funds only enough for that.
            await fundedRound();
            const greedy = [{ account: stranger.address, amount: parseEther("995") }];
            const gTree = buildTree(greedy);
            const small = parseEther("100");
            await reward.connect(creator).approve(dist.address, small);
            await dist.connect(creator).createRound(
                await params({ amount: small, allocated: parseEther("99"), merkleRoot: gTree.root })
            );
            // The contract holds 995 + 99.5 — enough to pay the greedy leaf,
            // but it is not round 1's to give.
            await expect(dist.claim(1, stranger.address, parseEther("995"), gTree.proof(stranger.address, parseEther("995"))))
                .to.be.revertedWithCustomError(dist, "RoundOverClaimed");
            // Round 0 still pays in full.
            for (const e of entries) {
                await dist.claim(0, e.account, e.amount, tree.proof(e.account, e.amount));
            }
        });

        it("claimMany takes several rounds in one transaction", async function () {
            const a = await fundedRound();
            const b = await fundedRound();
            const amt = entries[0].amount;
            const proof = tree.proof(alice.address, amt);
            await dist.claimMany([a, b], alice.address, [amt, amt], [proof, proof]);
            expect(await reward.balanceOf(alice.address)).to.equal(amt.mul(2));
            await expect(dist.claimMany([a], alice.address, [amt, amt], [proof]))
                .to.be.revertedWithCustomError(dist, "LengthMismatch");
        });

        it("works for a single-leaf tree (empty proof)", async function () {
            const solo = buildTree([{ account: alice.address, amount: NET }]);
            const id = await fundedRound({ merkleRoot: solo.root });
            await dist.claim(id, alice.address, NET, []);
            expect(await reward.balanceOf(alice.address)).to.equal(NET);
        });
    });

    describe("reclaimExpired", function () {
        it("returns what nobody claimed, only to the creator, only after expiry, once", async function () {
            const id = await fundedRound();
            await dist.claim(id, alice.address, entries[0].amount, tree.proof(alice.address, entries[0].amount));
            await expect(dist.connect(creator).reclaimExpired(id))
                .to.be.revertedWithCustomError(dist, "RoundNotExpired");
            await increaseTime(90 * DAY);
            await expect(dist.connect(stranger).reclaimExpired(id))
                .to.be.revertedWithCustomError(dist, "NotRoundCreator");
            const before = await reward.balanceOf(creator.address);
            const left = NET.sub(entries[0].amount);
            await expect(dist.connect(creator).reclaimExpired(id))
                .to.emit(dist, "RoundReclaimed").withArgs(id, creator.address, left);
            expect((await reward.balanceOf(creator.address)).sub(before)).to.equal(left);
            await expect(dist.connect(creator).reclaimExpired(id))
                .to.be.revertedWithCustomError(dist, "RoundAlreadyReclaimed");
        });

        it("has nothing to give back when every leaf was claimed", async function () {
            const id = await fundedRound();
            for (const e of entries) await dist.claim(id, e.account, e.amount, tree.proof(e.account, e.amount));
            await increaseTime(90 * DAY);
            await expect(dist.connect(creator).reclaimExpired(id))
                .to.be.revertedWithCustomError(dist, "NothingToReclaim");
        });
    });

    describe("admin", function () {
        it("caps the fee and only lets the owner set it", async function () {
            await expect(dist.connect(stranger).setFee(treasury.address, 10))
                .to.be.revertedWithCustomError(dist, "NotOwner");
            await expect(dist.connect(owner).setFee(treasury.address, 201))
                .to.be.revertedWithCustomError(dist, "FeeTooHigh");
            await expect(ethers.getContractFactory("HolderRewardDistributor")
                .then((D) => D.deploy(owner.address, treasury.address, 201)))
                .to.be.revertedWithCustomError(dist, "FeeTooHigh");
        });

        it("transfers ownership in two steps", async function () {
            await dist.connect(owner).transferOwnership(stranger.address);
            expect(await dist.owner()).to.equal(owner.address);
            await expect(dist.connect(bob).acceptOwnership())
                .to.be.revertedWithCustomError(dist, "NotPendingOwner");
            await dist.connect(stranger).acceptOwnership();
            expect(await dist.owner()).to.equal(stranger.address);
            expect(await dist.pendingOwner()).to.equal(ZERO);
        });

        it("a fee change does not touch a round already funded", async function () {
            const id = await fundedRound();
            await dist.connect(owner).setFee(treasury.address, 200);
            expect((await dist.getRound(id)).totalAmount).to.equal(NET);
        });
    });

    it("pays 2,000 holders from one root (gas per claim stays flat)", async function () {
        const many: { account: string; amount: BigNumber }[] = [];
        for (let i = 0; i < 2000; i++) {
            many.push({ account: ethers.utils.getAddress(ethers.utils.hexZeroPad(ethers.utils.hexlify(i + 1000), 20)), amount: parseEther("0.4") });
        }
        many.push({ account: alice.address, amount: parseEther("195") });
        const big = buildTree(many);
        const id = await fundedRound({ merkleRoot: big.root });
        const tx = await dist.claim(id, alice.address, parseEther("195"), big.proof(alice.address, parseEther("195")));
        const gas = (await tx.wait()).gasUsed.toNumber();
        // 12 proof levels, cold slots: ~129k. A V2 pool claim is in the same range.
        expect(gas).to.be.lessThan(150000);
        const last = many[1999];
        await dist.claim(id, last.account, last.amount, big.proof(last.account, last.amount));
    });
});
