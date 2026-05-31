// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title CrowdfundingV1
 * @notice EVM/Solidity port of the Stellar `crowdfunding_v1` contract.
 *         An escrow-based crowdfunding campaign: investors contribute an ERC20
 *         payment token to buy shares (out of 10,000) at a fixed price; funds
 *         are escrowed until the deadline. After the deadline anyone can
 *         `finalize`: if shares sold >= soft cap the campaign Succeeds, else it
 *         Fails. On success the admin `activate`s, moving the escrowed funds to
 *         a pre-deployed DistributionPoolV2 splitter (which then distributes to
 *         contributors via claim). On failure investors `refund`.
 *
 *         Standalone contract (one per campaign), mirroring the Stellar design.
 *         Lifecycle: Fundraising -> Succeeded|Failed -> Activated.
 */
contract CrowdfundingV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TOTAL_SHARES = 10_000;

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

    // ---- events ----
    event CfInit(address indexed admin, address indexed paymentToken, uint256 pricePerShare, uint256 softCapShares, uint256 hardCapShares, uint256 deadline);
    event CfContribute(address indexed investor, uint256 sharesAmount, uint256 payment, uint256 totalSharesSold);
    event CfFinalized(Status status, uint256 totalSharesSold, uint256 totalRaised);
    event CfActivated(address indexed splitter, uint256 totalRaised);
    event CfRefunded(address indexed investor, uint256 shares, uint256 refundAmount);

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
        paymentToken.safeTransferFrom(msg.sender, address(this), payment);

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
     * Admin moves the escrowed funds to a pre-deployed splitter (whose shares
     * must match the contributors). Only when Succeeded.
     */
    function activate(address _splitter) external onlyAdmin nonReentrant returns (uint256 raised) {
        if (status == Status.Activated) revert AlreadyActivated();
        if (status != Status.Succeeded) revert NotSucceeded();
        if (_splitter == address(0)) revert ZeroSplitter();

        raised = totalRaised;
        splitter = _splitter;
        status = Status.Activated;

        paymentToken.safeTransfer(_splitter, raised);
        emit CfActivated(_splitter, raised);
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
