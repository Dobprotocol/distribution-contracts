// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title HolderRewardDistributor — pay the holders of a token that already exists
 *
 * A DistributionPoolV2 can only pay the holders of its own participation token:
 * it calls `snapshot()` / `balanceOfAt()` on it, and PoolMaster only accepts a
 * token with 0 decimals and a capped supply. A token that already trades on
 * Uniswap has neither, and it cannot be retrofitted with a snapshot. So the
 * snapshot is taken off-chain and committed here as a Merkle root.
 *
 * One contract per chain, any number of rounds. A round is:
 *   - funded up front by whoever creates it (the reward is pulled in at
 *     creation, so a root can never promise money that is not here);
 *   - a Merkle root over (account, amount) leaves — the amount each holder is
 *     owed, already computed, not a balance;
 *   - claimable by anyone on behalf of an account (the money always goes to the
 *     account in the leaf), from `claimableFrom` until `expiresAt`;
 *   - reclaimable by its creator after it expires, for whatever was not claimed.
 *
 * Who is in the tree and with how much is decided off-chain, and the round
 * records enough to reproduce it: the token whose holders are paid, the block
 * window the balances were read over and a URI for the full leaf list. The root
 * is the creator's to choose — the same power a V2 pool admin has over the
 * moment its snapshot is taken — but it can only hand out the creator's own
 * money, and only this round's: each round's claims are capped at its own
 * `totalAmount`, so a wrong root cannot reach into another round's balance.
 *
 * Leaves follow OpenZeppelin's StandardMerkleTree encoding:
 *   leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
 * The double hash keeps a 64-byte inner node from ever being read as a leaf.
 *
 * Commission matches DistributionPoolV2: a fee (50 bps by default, capped at
 * MAX_FEE_BPS) is taken once, when the round is funded, and the tree is built
 * over what is left. Not upgradeable on purpose — a distributor that holds
 * other people's rewards should not be able to change its rules under them.
 */
contract HolderRewardDistributor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Round {
        address creator;
        address rewardToken;
        /// The token whose holders this round pays. Informational: the
        /// contract never reads it, it is there so the tree can be audited.
        address holderToken;
        bytes32 merkleRoot;
        /// What the leaves may add up to: the funded amount minus the fee.
        uint256 totalAmount;
        uint256 totalClaimed;
        /// Block window the balances were read over (informational).
        uint64 snapshotFromBlock;
        uint64 snapshotToBlock;
        uint64 claimableFrom;
        uint64 expiresAt;
        bool reclaimed;
    }

    // ========================================================================
    // Constants
    // ========================================================================

    uint256 public constant MAX_FEE_BPS = 200; // 2%
    /// Long enough that a holder who checks once a month does not miss it.
    uint64 public constant MIN_DURATION = 30 days;
    uint64 public constant MAX_DURATION = 3650 days;
    uint64 public constant MAX_CLAIM_DELAY = 30 days;

    // ========================================================================
    // Storage
    // ========================================================================

    address public owner;
    address public pendingOwner;
    address public feeRecipient;
    uint256 public feeBps;

    uint256 public roundCount;
    mapping(uint256 => Round) private _rounds;
    mapping(uint256 => mapping(address => bool)) private _claimed;

    // ========================================================================
    // Events
    // ========================================================================

    event RoundCreated(
        uint256 indexed roundId,
        address indexed creator,
        address indexed holderToken,
        address rewardToken,
        bytes32 merkleRoot,
        uint256 totalAmount,
        uint256 fee,
        uint64 claimableFrom,
        uint64 expiresAt
    );
    /// How to rebuild the tree of a round: the window its balances were read
    /// over and where the leaf list lives. Split from RoundCreated only because
    /// one event with all of it does not fit in the stack.
    event RoundTree(uint256 indexed roundId, uint64 snapshotFromBlock, uint64 snapshotToBlock, string treeUri);
    event Claimed(uint256 indexed roundId, address indexed account, uint256 amount, address caller);
    event RoundReclaimed(uint256 indexed roundId, address indexed creator, uint256 amount);
    event FeeUpdated(address recipient, uint256 bps);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ========================================================================
    // Errors
    // ========================================================================

    error NotOwner();
    error NotPendingOwner();
    error NotRoundCreator();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroRoot();
    error FeeTooHigh();
    error InvalidDuration();
    error InvalidClaimDelay();
    error InvalidSnapshotWindow();
    error AllocationExceedsFunding();
    /// The reward token delivered less than it was asked for (fee-on-transfer):
    /// the tree was built over the requested amount and would not be solvent.
    error TransferAmountMismatch();
    error RoundNotFound();
    error ClaimsNotOpenYet();
    error RoundExpired();
    error RoundNotExpired();
    error RoundAlreadyReclaimed();
    error AlreadyClaimed();
    error InvalidProof();
    error RoundOverClaimed();
    error LengthMismatch();
    error NothingToReclaim();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// The owner goes in the constructor, not an `initialize`, so there is no
    /// window where the contract sits deployed and claimable by the first caller.
    constructor(address _owner, address _feeRecipient, uint256 _feeBps) {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
        _setFee(_feeRecipient, _feeBps);
    }

    // ========================================================================
    // Rounds
    // ========================================================================

    /// Everything `createRound` needs, in one argument: the flat signature
    /// overflowed the stack.
    struct RoundParams {
        address rewardToken;      // ERC20 paid out (needs an allowance of `amount`)
        address holderToken;      // token whose holders the tree pays (audit trail)
        uint256 amount;           // pulled from the caller; the fee comes out of it
        uint256 allocated;        // sum of every leaf; must fit in `amount - fee`
        bytes32 merkleRoot;       // root over (account, amount) leaves
        uint64 snapshotFromBlock; // window the balances were read over
        uint64 snapshotToBlock;
        uint64 claimDelay;        // seconds before claims open (0 = now)
        uint64 duration;          // seconds claims stay open after they do
        string treeUri;           // where the full leaf list can be downloaded
    }

    /**
     * Fund a round and commit its tree. `allocated` is what makes the round
     * solvent: the root is not checked against it on-chain (it cannot be), but
     * `_claim` caps the round at `totalAmount`, so an under-declared sum only
     * means the last claimers find the round empty — never another round's money.
     */
    function createRound(RoundParams calldata p) external nonReentrant returns (uint256 roundId) {
        if (p.rewardToken == address(0) || p.holderToken == address(0)) revert ZeroAddress();
        if (p.amount == 0 || p.allocated == 0) revert ZeroAmount();
        if (p.merkleRoot == bytes32(0)) revert ZeroRoot();
        if (p.duration < MIN_DURATION || p.duration > MAX_DURATION) revert InvalidDuration();
        if (p.claimDelay > MAX_CLAIM_DELAY) revert InvalidClaimDelay();
        if (p.snapshotFromBlock > p.snapshotToBlock || p.snapshotToBlock > block.number) {
            revert InvalidSnapshotWindow();
        }

        uint256 fee = feeRecipient == address(0) ? 0 : (p.amount * feeBps) / 10000;
        uint256 net = p.amount - fee;
        if (p.allocated > net) revert AllocationExceedsFunding();

        _pull(p.rewardToken, p.amount, fee);

        roundId = roundCount++;
        uint64 claimableFrom = uint64(block.timestamp) + p.claimDelay;
        uint64 expiresAt = claimableFrom + p.duration;
        _rounds[roundId] = Round({
            creator: msg.sender,
            rewardToken: p.rewardToken,
            holderToken: p.holderToken,
            merkleRoot: p.merkleRoot,
            totalAmount: net,
            totalClaimed: 0,
            snapshotFromBlock: p.snapshotFromBlock,
            snapshotToBlock: p.snapshotToBlock,
            claimableFrom: claimableFrom,
            expiresAt: expiresAt,
            reclaimed: false
        });

        emit RoundCreated(
            roundId, msg.sender, p.holderToken, p.rewardToken, p.merkleRoot, net, fee, claimableFrom, expiresAt
        );
        emit RoundTree(roundId, p.snapshotFromBlock, p.snapshotToBlock, p.treeUri);
    }

    /// Pull the funding and forward the fee. Rejects a token that delivers less
    /// than asked (fee-on-transfer): the tree was built over the full amount.
    function _pull(address rewardToken, uint256 amount, uint256 fee) internal {
        IERC20 token = IERC20(rewardToken);
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - before != amount) revert TransferAmountMismatch();
        if (fee > 0) token.safeTransfer(feeRecipient, fee);
    }

    /// Pay `account` its leaf. Anyone may send it; the money goes to `account`.
    function claim(uint256 roundId, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        _claim(roundId, account, amount, proof);
    }

    /// Several rounds for one account in one transaction.
    function claimMany(
        uint256[] calldata roundIds,
        address account,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) external nonReentrant {
        if (roundIds.length != amounts.length || roundIds.length != proofs.length) revert LengthMismatch();
        for (uint256 i = 0; i < roundIds.length; i++) {
            _claim(roundIds[i], account, amounts[i], proofs[i]);
        }
    }

    function _claim(uint256 roundId, address account, uint256 amount, bytes32[] calldata proof) internal {
        Round storage r = _rounds[roundId];
        if (r.creator == address(0)) revert RoundNotFound();
        if (r.reclaimed) revert RoundAlreadyReclaimed();
        if (block.timestamp < r.claimableFrom) revert ClaimsNotOpenYet();
        if (block.timestamp >= r.expiresAt) revert RoundExpired();
        if (_claimed[roundId][account]) revert AlreadyClaimed();
        if (amount == 0) revert ZeroAmount();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        if (!MerkleProof.verifyCalldata(proof, r.merkleRoot, leaf)) revert InvalidProof();

        // The per-round cap: a tree whose leaves add up to more than the round
        // holds stops paying here instead of spending another round's funds.
        uint256 claimedAfter = r.totalClaimed + amount;
        if (claimedAfter > r.totalAmount) revert RoundOverClaimed();

        _claimed[roundId][account] = true;
        r.totalClaimed = claimedAfter;
        IERC20(r.rewardToken).safeTransfer(account, amount);
        emit Claimed(roundId, account, amount, msg.sender);
    }

    /// After expiry the creator takes back whatever nobody claimed.
    function reclaimExpired(uint256 roundId) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (r.creator == address(0)) revert RoundNotFound();
        if (msg.sender != r.creator) revert NotRoundCreator();
        if (block.timestamp < r.expiresAt) revert RoundNotExpired();
        if (r.reclaimed) revert RoundAlreadyReclaimed();
        uint256 left = r.totalAmount - r.totalClaimed;
        if (left == 0) revert NothingToReclaim();
        r.reclaimed = true;
        IERC20(r.rewardToken).safeTransfer(r.creator, left);
        emit RoundReclaimed(roundId, r.creator, left);
    }

    // ========================================================================
    // Views
    // ========================================================================

    function getRound(uint256 roundId) external view returns (Round memory) {
        if (_rounds[roundId].creator == address(0)) revert RoundNotFound();
        return _rounds[roundId];
    }

    function isClaimed(uint256 roundId, address account) external view returns (bool) {
        return _claimed[roundId][account];
    }

    /// Same answer `claim` would give, without spending gas to find out.
    function canClaim(uint256 roundId, address account, uint256 amount, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        Round storage r = _rounds[roundId];
        if (r.creator == address(0) || r.reclaimed || amount == 0) return false;
        if (block.timestamp < r.claimableFrom || block.timestamp >= r.expiresAt) return false;
        if (_claimed[roundId][account]) return false;
        if (r.totalClaimed + amount > r.totalAmount) return false;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        return MerkleProof.verifyCalldata(proof, r.merkleRoot, leaf);
    }

    // ========================================================================
    // Admin
    // ========================================================================

    /// Applies to rounds created afterwards; a funded round already paid its fee.
    function setFee(address recipient, uint256 bps) external onlyOwner {
        _setFee(recipient, bps);
    }

    function _setFee(address recipient, uint256 bps) internal {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        feeRecipient = recipient;
        feeBps = bps;
        emit FeeUpdated(recipient, bps);
    }

    /// Two steps, like `set_admin` on the Stellar contracts after the audit.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}
