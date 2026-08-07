// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../../../interface/dob/DistributionPoolInterface.sol";

/**
 * @title CrowdfundingV1
 * @notice EVM/Solidity port of the Stellar `crowdfunding_v1` contract.
 *         An escrow-based crowdfunding campaign: investors contribute an ERC20
 *         payment token to buy shares (out of 10,000) at a fixed price; funds
 *         are escrowed until the deadline. After the deadline anyone can
 *         `finalize`: if shares sold >= soft cap the campaign Succeeds, else it
 *         Fails. On success the admin announces the destination splitter with
 *         `proposeActivation` and, one timelock later, calls `activate` to move
 *         the escrowed funds to that pre-deployed DistributionPoolV2 (which then
 *         distributes to contributors via claim). On failure investors `refund`;
 *         if the admin never activates, `expireActivation` opens refunds too.
 *
 *         Standalone contract (one per campaign), mirroring the Stellar design.
 *         Lifecycle: Fundraising -> Succeeded|Failed -> Activated.
 */
contract CrowdfundingV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TOTAL_SHARES = 10_000;

    /// How long an announced activation must sit in public before it can
    /// execute (AUDIT 2026-08 / N-1).
    ///
    /// DELIBERATELY ZERO. The two-step flow is kept — the destination is still
    /// probed, still announced on-chain, and `activate` still has to repeat the
    /// exact address that was proposed — but the protocol imposes no waiting
    /// period on a legitimate raise. Announcing and then waiting is a policy the
    /// platform can apply off-chain simply by not activating immediately; while
    /// it waits, `optOut` below is open. The checks that read this constant are
    /// left in place and armed, so raising it to `1 days` is a one-line change
    /// that needs no other edit and no ABI churn.
    uint256 public constant ACTIVATION_TIMELOCK = 0;

    /// How long after the campaign deadline the admin has to activate before
    /// investors can force refunds open (AUDIT 2026-08 / N-2).
    uint256 public constant ACTIVATION_DEADLINE = 90 days;

    enum Status { Fundraising, Succeeded, Failed, Activated }

    address public immutable admin;
    IERC20 public immutable paymentToken;
    uint256 public immutable pricePerShare;   // payment-token units per 1 share
    uint256 public immutable softCapShares;    // [1, TOTAL_SHARES]
    uint256 public immutable hardCapShares;    // [softCap, TOTAL_SHARES]
    uint256 public immutable deadline;         // unix ts; finalize allowed after

    Status public status;
    uint256 public totalSharesSold;
    uint256 public totalRaised;
    address public splitter;

    /// Announced-but-not-yet-executed activation target (AUDIT 2026-08 / N-1).
    address public pendingSplitter;
    /// Earliest timestamp at which {activate} may run for {pendingSplitter}.
    uint256 public activationEta;

    mapping(address => uint256) public contributions; // investor => shares bought

    // ---- errors ----
    error InvalidPrice();
    error InvalidCap();
    error InvalidDeadline();
    error CampaignNotActive();
    error InvalidSharesAmount();
    error HardCapReached();
    error DeadlineNotReached();
    error AlreadyFinalized();
    error NotSucceeded();
    error NotFailed();
    error AlreadyActivated();
    error NothingToRefund();
    error OnlyAdmin();
    error ZeroSplitter();
    // Activation (AUDIT 2026-08 / N-1, N-2)
    error NoPendingActivation();
    error ActivationTimelockPending();
    error SplitterMismatch();
    error InvalidSplitter();
    error ActivationWindowExpired();
    error ActivationWindowStillOpen();
    error PaymentTokenNotSupported();
    /// Kept declared, no longer thrown: `optOut` is gated on a proposal being
    /// pending rather than on the (zero) timelock. Raising ACTIVATION_TIMELOCK
    /// above zero does not resurrect it either — the exit stays open for the
    /// whole pending period by design.
    error NoticePeriodOver();

    // ---- events ----
    event CfInit(address indexed admin, address indexed paymentToken, uint256 pricePerShare, uint256 softCapShares, uint256 hardCapShares, uint256 deadline);
    event CfContribute(address indexed investor, uint256 sharesAmount, uint256 payment, uint256 totalSharesSold);
    event CfFinalized(Status status, uint256 totalSharesSold, uint256 totalRaised);
    event CfActivated(address indexed splitter, uint256 totalRaised);
    event CfRefunded(address indexed investor, uint256 shares, uint256 refundAmount);
    event CfActivationProposed(address indexed splitter, uint256 eta);
    event CfActivationCancelled(address indexed splitter);
    event CfActivationExpired(uint256 totalRaised);
    event CfOptOut(address indexed investor, uint256 shares, uint256 refundAmount);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    constructor(
        address _admin,
        address _paymentToken,
        uint256 _pricePerShare,
        uint256 _softCapShares,
        uint256 _hardCapShares,
        uint256 _deadline
    ) {
        if (_pricePerShare == 0) revert InvalidPrice();
        if (_softCapShares == 0 || _softCapShares > TOTAL_SHARES || _hardCapShares < _softCapShares || _hardCapShares > TOTAL_SHARES) {
            revert InvalidCap();
        }
        if (_deadline <= block.timestamp) revert InvalidDeadline();

        admin = _admin;
        paymentToken = IERC20(_paymentToken);
        pricePerShare = _pricePerShare;
        softCapShares = _softCapShares;
        hardCapShares = _hardCapShares;
        deadline = _deadline;
        status = Status.Fundraising;

        emit CfInit(_admin, _paymentToken, _pricePerShare, _softCapShares, _hardCapShares, _deadline);
    }

    /**
     * Buy `sharesAmount` shares. Caller must have approved this contract for
     * `sharesAmount * pricePerShare` of the payment token. Funds are escrowed.
     */
    function contribute(uint256 sharesAmount) external nonReentrant returns (uint256 payment) {
        if (status != Status.Fundraising || block.timestamp >= deadline) revert CampaignNotActive();
        if (sharesAmount == 0) revert InvalidSharesAmount();
        if (totalSharesSold + sharesAmount > hardCapShares) revert HardCapReached();

        payment = sharesAmount * pricePerShare;

        // effects
        contributions[msg.sender] += sharesAmount;
        totalSharesSold += sharesAmount;
        totalRaised += payment;

        // interaction (escrow into this contract)
        //
        // AUDIT 2026-08 (N-3). The books credit `sharesAmount * pricePerShare`,
        // so a fee-on-transfer or rebasing payment token would leave the escrow
        // structurally short and the last investors to refund unpaid. Rather
        // than try to account for such tokens, reject them at the first
        // contribution: measure what actually arrived.
        uint256 balanceBefore = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), payment);
        if (paymentToken.balanceOf(address(this)) - balanceBefore != payment) {
            revert PaymentTokenNotSupported();
        }

        emit CfContribute(msg.sender, sharesAmount, payment, totalSharesSold);
    }

    /**
     * After the deadline, lock in Succeeded (>= soft cap) or Failed. Anyone.
     */
    function finalize() external returns (Status) {
        if (status != Status.Fundraising) revert AlreadyFinalized();
        if (block.timestamp < deadline) revert DeadlineNotReached();

        status = totalSharesSold >= softCapShares ? Status.Succeeded : Status.Failed;
        emit CfFinalized(status, totalSharesSold, totalRaised);
        return status;
    }

    /**
     * AUDIT 2026-08 (N-1). Step 1 of activation: the admin announces which
     * splitter will receive the escrow, and the announcement has to sit in
     * public for ACTIVATION_TIMELOCK before it can execute.
     *
     * Be clear about what this does and does not buy. The campaign keeps no
     * index of its investors (only a per-address mapping), so it cannot verify
     * on-chain that the proposed splitter's cap table matches the contributors —
     * that check is impossible here by construction. What it can do is refuse
     * addresses that are obviously not a pool — which is what actually kills the
     * fat-finger that used to send an entire raise into the void — and put the
     * destination on-chain before a single token moves, so the transfer is
     * auditable instead of silent.
     *
     * With ACTIVATION_TIMELOCK at zero the admin may call `activate` right
     * after this. The announcement is then an audit record rather than a review
     * window; the window is optional and served by waiting.
     */
    function proposeActivation(address _splitter) external onlyAdmin returns (uint256 eta) {
        if (status == Status.Activated) revert AlreadyActivated();
        if (status != Status.Succeeded) revert NotSucceeded();
        if (_splitter == address(0)) revert ZeroSplitter();
        if (
            _splitter == address(this) ||
            _splitter == address(paymentToken) ||
            _splitter == admin
        ) revert InvalidSplitter();

        // Probe: a distribution pool answers getParticipationToken(). A plain
        // wallet has no code, and an unrelated contract reverts or returns
        // garbage the decoder rejects.
        if (_splitter.code.length == 0) revert InvalidSplitter();
        try DistributionPoolInterface(_splitter).getParticipationToken() returns (address pt) {
            if (pt == address(0)) revert InvalidSplitter();
        } catch {
            revert InvalidSplitter();
        }

        eta = block.timestamp + ACTIVATION_TIMELOCK;
        pendingSplitter = _splitter;
        activationEta = eta;
        emit CfActivationProposed(_splitter, eta);
    }

    /**
     * Admin withdraws a pending proposal (wrong address, changed plan).
     */
    function cancelActivation() external onlyAdmin {
        if (pendingSplitter == address(0)) revert NoPendingActivation();
        emit CfActivationCancelled(pendingSplitter);
        pendingSplitter = address(0);
        activationEta = 0;
    }

    /**
     * Step 2: move the escrowed funds to the splitter announced earlier. Only
     * when Succeeded, only the exact address that was proposed, only after the
     * timelock, and only inside the activation window.
     */
    function activate(address _splitter) external onlyAdmin nonReentrant returns (uint256 raised) {
        if (status == Status.Activated) revert AlreadyActivated();
        if (status != Status.Succeeded) revert NotSucceeded();
        if (pendingSplitter == address(0)) revert NoPendingActivation();
        if (pendingSplitter != _splitter) revert SplitterMismatch();
        if (block.timestamp < activationEta) revert ActivationTimelockPending();
        if (block.timestamp >= deadline + ACTIVATION_DEADLINE) revert ActivationWindowExpired();

        raised = totalRaised;
        splitter = _splitter;
        status = Status.Activated;
        pendingSplitter = address(0);
        activationEta = 0;

        paymentToken.safeTransfer(_splitter, raised);
        emit CfActivated(_splitter, raised);
    }

    /**
     * AUDIT 2026-08 (N-1, second half). An announcement is only worth something
     * if investors can act on it. While a proposal is pending — from the moment
     * it is announced until it executes or is withdrawn — a contributor who
     * does not accept the destination takes their money back and leaves.
     *
     * This is gated on the proposal being pending, NOT on the timelock, which
     * is zero: an exit tied to a zero-length window would be unreachable code.
     * So the length of the exit window is exactly how long the admin waits
     * between proposing and activating. Activate immediately and there is no
     * exit; announce a day ahead and investors have that day.
     *
     * Leaving also withdraws the proposal. The admin sized the splitter's cap
     * table against the contributor list as it stood when they proposed; if
     * someone exits, that list is stale, and activating anyway would hand pool
     * shares to an investor who has already been repaid. So the admin has to
     * re-propose against the corrected list and serve a fresh notice. Each
     * investor can only force this once (their position goes to zero), so the
     * reset is bounded by the number of contributors.
     *
     * AUDIT 2026-08 (S-3) — and if the exits take the raise back under the soft
     * cap, the campaign fails. See the block at the end of this function.
     */
    function optOut() external nonReentrant returns (uint256 refundAmount) {
        if (status == Status.Activated) revert AlreadyActivated();
        if (status != Status.Succeeded) revert NotSucceeded();
        if (pendingSplitter == address(0)) revert NoPendingActivation();

        uint256 shares = contributions[msg.sender];
        if (shares == 0) revert NothingToRefund();

        refundAmount = shares * pricePerShare;

        // effects
        contributions[msg.sender] = 0;
        totalSharesSold -= shares;
        totalRaised -= refundAmount;
        emit CfActivationCancelled(pendingSplitter);
        pendingSplitter = address(0);
        activationEta = 0;

        // AUDIT 2026-08 (S-3). The soft cap is a promise made to the investors
        // who stay: "this only goes ahead if at least N shares are sold".
        // Nothing re-checked it after an exit, so a campaign that dropped under
        // its own minimum stayed Succeeded and the admin could activate —
        // funding the project with less money than the campaign said it needed,
        // and handing the remaining investors a cap table they never agreed to.
        //
        // The rule already exists in {finalize}; this re-applies it. Below the
        // cap the campaign is Failed, which closes {activate} and opens the
        // ordinary {refund} path for everyone left, immediately — no waiting out
        // the 90-day activation window. Announced with {CfFinalized}, the same
        // event {finalize} emits, so indexers need no new case.
        //
        // The cost, stated plainly: a contributor large enough to break the cap
        // can kill the campaign while a proposal stands. That exposure is
        // entirely in the admin's hands — ACTIVATION_TIMELOCK is zero, so an
        // admin who proposes and activates in the same transaction offers no
        // window at all. Refusing the exit instead would trap precisely the
        // biggest investor, who is the one this whole flow protects.
        if (totalSharesSold < softCapShares) {
            status = Status.Failed;
            emit CfFinalized(Status.Failed, totalSharesSold, totalRaised);
        }

        paymentToken.safeTransfer(msg.sender, refundAmount);
        emit CfOptOut(msg.sender, shares, refundAmount);
    }

    /**
     * AUDIT 2026-08 (N-2). Escape hatch for a campaign that hit its soft cap and
     * was then abandoned. `refund` only opens on Failed, and only the admin
     * could move a Succeeded campaign anywhere — so an admin who simply walked
     * away left every contribution locked in escrow forever. After the
     * activation window closes, anyone can flip the campaign to Failed, which
     * opens the ordinary per-investor refund path.
     */
    function expireActivation() external returns (Status) {
        if (status != Status.Succeeded) revert NotSucceeded();
        if (block.timestamp < deadline + ACTIVATION_DEADLINE) revert ActivationWindowStillOpen();

        status = Status.Failed;
        pendingSplitter = address(0);
        activationEta = 0;
        emit CfActivationExpired(totalRaised);
        return status;
    }

    /**
     * Investor reclaims their full contribution if the campaign Failed.
     */
    function refund() external nonReentrant returns (uint256 refundAmount) {
        if (status != Status.Failed) revert NotFailed();
        uint256 shares = contributions[msg.sender];
        if (shares == 0) revert NothingToRefund();

        refundAmount = shares * pricePerShare;
        // effects (prevent double refund)
        contributions[msg.sender] = 0;

        paymentToken.safeTransfer(msg.sender, refundAmount);
        emit CfRefunded(msg.sender, shares, refundAmount);
    }

    // ---- views ----
    function getPendingActivation() external view returns (address _splitter, uint256 _eta) {
        return (pendingSplitter, activationEta);
    }

    function getContribution(address investor) external view returns (uint256) {
        return contributions[investor];
    }

    function getConfig()
        external
        view
        returns (
            address _admin,
            address _paymentToken,
            uint256 _pricePerShare,
            uint256 _softCapShares,
            uint256 _hardCapShares,
            uint256 _deadline,
            Status _status,
            uint256 _totalSharesSold
        )
    {
        return (admin, address(paymentToken), pricePerShare, softCapShares, hardCapShares, deadline, status, totalSharesSold);
    }
}
