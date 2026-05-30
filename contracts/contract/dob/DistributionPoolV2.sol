// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../types/KeyPrefix.sol";
import "./BasePool.sol";

/**
 * @title DistributionPoolV2
 * @notice Lazy, pull-based distribution logic — an EVM port of the Stellar
 *         `soro-splitter-v2` design.
 *
 *         Unlike the legacy {DistributionPool} (push model: an O(n) loop over
 *         every shareholder in one tx, which capped pools at a few hundred
 *         holders), V2 is O(1):
 *
 *           - `createDistribution(token)`  — admin snapshots the unallocated
 *             balance into a round (no per-holder loop).
 *           - `claim(shareholder,token,roundId)` — each holder pulls their
 *             pro-rata share (O(1) per claim).
 *
 *         This removes the gas ceiling, so V2 pools scale to 10,000+
 *         shareholders. V2 is pull-native: the legacy `distribute(address[])`
 *         push path is intentionally disabled (it reverts), keeping the
 *         deployed bytecode under the EIP-170 limit and the model unambiguous.
 *
 *         It extends {BasePool} (sharing deposits, withdrawals, commission /
 *         treasury plumbing, getters and the UUPS upgrade hooks) and keeps the
 *         `"distribution.pool"` storage namespace, so {PoolMaster} can create
 *         V2 pools with no factory changes. All new state lives in
 *         EternalStorage under APPEND-ONLY {KeyPrefix} entries.
 *
 *         Reserve accounting reuses the existing `KeyPrefix.distribution`
 *         accumulator, so `getTotalDistAmount` stays correct. Invariant:
 *           distribution[token] == Σ (round.totalAmount - round.totalClaimed)
 *                                    over active (non-reclaimed) rounds.
 */
contract DistributionPoolV2 is BasePool {
    using SafeMath for uint256;

    // ---- config defaults (mirror soro-splitter-v2) ----
    uint256 internal constant DEFAULT_MIN_INTERVAL = 12 hours;
    uint256 internal constant DEFAULT_CLAIM_DELAY = 0;
    uint256 internal constant DEFAULT_ROUND_EXPIRY = 365 days;
    uint256 internal constant DEFAULT_DIST_COMMISSION_BPS = 50; // 0.5%
    uint256 internal constant MAX_COMMISSION_BPS = 5000; // 50% hard cap

    // ---- custom errors (smaller bytecode than require-strings) ----
    error TokenNotSet();
    error NothingToDistribute();
    error NoParticipationSupply();
    error AmountAfterCommissionZero();
    error DistributionTooSoon();
    error RoundNotFound();
    error AlreadyClaimed();
    error ClaimWindowNotOpen();
    error RoundExpired();
    error NothingToClaim();
    error NothingClaimed();
    error RoundNotExpired();
    error AlreadyReclaimed();
    error NothingToReclaim();
    error ExpiryMustBePositive();
    error OnlyCommissionRecipient();
    error CommissionTooHigh();
    error TransferFailed();
    error PushDisabled();
    error ExternalTokenAlreadySet();

    // ---- events (indexed on the dimensions the indexer queries) ----
    event DistributionRoundCreated(
        address indexed token,
        uint256 indexed roundId,
        uint256 totalAmount,
        uint256 totalSupplySnapshot,
        uint256 commission,
        uint256 claimableFrom,
        uint256 expiresAt
    );
    event Claimed(
        address indexed token,
        uint256 indexed roundId,
        address indexed shareholder,
        uint256 amount
    );
    event RoundReclaimed(
        address indexed token,
        uint256 indexed roundId,
        uint256 remainder
    );
    event DistributionConfigUpdated(
        uint256 minIntervalSeconds,
        uint256 claimDelaySeconds,
        uint256 roundExpirySeconds
    );
    event DistributionCommissionUpdated(address indexed setter, uint256 bps);

    constructor(
        address _storage
    ) AccessStorageOwnableInitializable(_storage, "distribution.pool") {}

    function getPoolVersion()
        public
        pure
        virtual
        override
        returns (string memory)
    {
        return "3.0";
    }

    /**
     * @param _poolData json-serialized pool metadata
     * @param _addresses [operational, treasury, participationToken, owner]
     * @param _vars [commission, coef, intercept, nDistributions,
     *               firstDistributionDate, distributionInterval, goalAmount, poolType]
     */
    function initialize(
        string memory _poolData,
        address[4] memory _addresses,
        uint256[8] memory _vars
    ) public initializer {
        require(_vars[7] < 3, "unkown poolType");
        _transferOwnership(_addresses[3]);
        __base_init(_addresses, _vars);
        _setKeyString(address(0), "poolData", _poolData);
        // register chain currency for distributions
        _addDistConfig(address(0), _vars[4], _vars[3], _vars[5], _vars[6]);
    }

    //******************************* */
    // UUPS upgrade hooks (from LogicProxiable / LogicUpgrade)

    function _setImplementation(address newImplementation) internal override {
        _S.setAddress(_getImplementationSlot(), newImplementation);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    function getImplementation() public view override returns (address) {
        return _S.getAddress(_getImplementationSlot());
    }

    //******************************* */
    // external token registration

    function _addDistConfig(
        address _newToken,
        uint256 _firstDistributionDate,
        uint256 _nDistributions,
        uint256 _distributionInterval,
        uint256 _goalAmount
    ) internal {
        _S.setBool(_ptKey(KeyPrefix.externalTokenExists, _newToken), true);
        _S.setUint256(_ptKey(KeyPrefix.firstDistributionDate, _newToken), _firstDistributionDate);
        _S.setUint256(_ptKey(KeyPrefix.nDistributions, _newToken), _nDistributions);
        _S.setUint256(_ptKey(KeyPrefix.distributionInterval, _newToken), _distributionInterval);
        _S.setUint256(_ptKey(KeyPrefix.index, _newToken), 0);
        _S.setUint256(_ptKey(KeyPrefix.goalAmount, _newToken), _goalAmount);
        emit updateExternalTokenInfo(msg.sender, _newToken);
    }

    function addExternalToken(address _newToken) public hasAccess {
        if (_S.getBool(_ptKey(KeyPrefix.externalTokenExists, _newToken))) {
            revert ExternalTokenAlreadySet();
        }
        _addDistConfig(
            _newToken,
            _S.getUint256(_ptKey(KeyPrefix.firstDistributionDate, address(0))),
            _S.getUint256(_ptKey(KeyPrefix.nDistributions, address(0))),
            _S.getUint256(_ptKey(KeyPrefix.distributionInterval, address(0))),
            _S.getUint256(_ptKey(KeyPrefix.goalAmount, address(0)))
        );
    }

    function addExternalTokenWithConfig(
        address _newToken,
        uint256 firstDistributionDate,
        uint256 nDistributions,
        uint256 distributionInterval,
        uint256 goalAmount
    ) external hasAccess {
        if (_S.getBool(_ptKey(KeyPrefix.externalTokenExists, _newToken))) {
            revert ExternalTokenAlreadySet();
        }
        _addDistConfig(
            _newToken,
            firstDistributionDate,
            nDistributions,
            distributionInterval,
            goalAmount
        );
    }

    //******************************* */
    // disabled legacy push interface (V2 is pull-native)

    function canDistribute(address) public view override returns (bool) {
        return true;
    }

    function distribute(address[] memory, address) public override {
        revert PushDisabled();
    }

    //******************************* */
    // round / claim key helpers (reuse _nameSpace; no AccessStorage change)

    function _rKey(
        KeyPrefix _prefix,
        address _token,
        uint256 _roundId
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(_nameSpace, _prefix, _token, _roundId));
    }

    function _rcKey(
        KeyPrefix _prefix,
        address _token,
        uint256 _roundId,
        address _user
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(_nameSpace, _prefix, _token, _roundId, _user)
            );
    }

    //******************************* */
    // config getters (lazy defaults)

    function _distConfigSet() internal view returns (bool) {
        return _S.getBool(_pKey(KeyPrefix.distConfigSet));
    }

    function _minInterval() internal view returns (uint256) {
        if (_distConfigSet()) {
            return _S.getUint256(_pKey(KeyPrefix.minIntervalSeconds));
        }
        return DEFAULT_MIN_INTERVAL;
    }

    function _claimDelay() internal view returns (uint256) {
        if (_distConfigSet()) {
            return _S.getUint256(_pKey(KeyPrefix.claimDelaySeconds));
        }
        return DEFAULT_CLAIM_DELAY;
    }

    function _roundExpiry() internal view returns (uint256) {
        if (_distConfigSet()) {
            return _S.getUint256(_pKey(KeyPrefix.roundExpirySeconds));
        }
        return DEFAULT_ROUND_EXPIRY;
    }

    function _distCommissionBps() internal view returns (uint256) {
        if (_S.getBool(_pKey(KeyPrefix.distCommissionSet))) {
            return _S.getUint256(_pKey(KeyPrefix.distCommissionBps));
        }
        return DEFAULT_DIST_COMMISSION_BPS;
    }

    //******************************* */
    // transfers

    function _transferOut(
        address _token,
        address _to,
        uint256 _amount
    ) internal {
        bool success;
        if (_token == address(0)) {
            success = _sendTo(_to, _amount);
        } else {
            success = IERC20(_token).transfer(_to, _amount);
        }
        if (!success) {
            revert TransferFailed();
        }
    }

    //******************************* */
    // create distribution (O(1))

    function _canCreateDistribution(
        address _token
    ) internal view returns (bool) {
        uint256 count = getStateVariableTokenUint256(
            uint256(KeyPrefix.roundCount),
            _token
        );
        if (count == 0) {
            return true;
        }
        uint256 minInt = _minInterval();
        if (minInt == 0) {
            return true;
        }
        uint256 last = getStateVariableTokenUint256(
            uint256(KeyPrefix.lastRoundCreatedAt),
            _token
        );
        return block.timestamp >= last.add(minInt);
    }

    /**
     * total balance of `token` held by this pool that is not reserved by an
     * active round (and, for native, net of prepay/gas). Available for a new
     * distribution. Mirrors DistributionPool.getTotalDistAmount.
     */
    function getTotalDistAmount(
        address token
    ) public view returns (uint256) {
        uint256 reserved = getStateVariableTokenUint256(
            uint256(KeyPrefix.distribution),
            token
        );
        if (token == address(0)) {
            return getEffectiveBalance() - reserved;
        }
        return IERC20(token).balanceOf(address(this)) - reserved;
    }

    /**
     * core round creation, no time-gating (used by both the gated external
     * entrypoint and the scheduled trigger).
     */
    function _doCreateDistribution(
        address _token
    ) internal returns (uint256 roundId) {
        if (
            _token != address(0) &&
            !_S.getBool(_ptKey(KeyPrefix.externalTokenExists, _token))
        ) {
            revert TokenNotSet();
        }

        uint256 unallocated = getTotalDistAmount(_token);
        if (unallocated == 0) {
            revert NothingToDistribute();
        }

        uint256 supply = IERC20(getParticipationToken()).totalSupply();
        if (supply == 0) {
            revert NoParticipationSupply();
        }

        uint256 commission = unallocated.mul(_distCommissionBps()).div(10000);
        uint256 totalAmount = unallocated.sub(commission);
        if (totalAmount == 0) {
            revert AmountAfterCommissionZero();
        }

        // reserve the distributable amount (commission leaves the contract now)
        uint256 dist = getStateVariableTokenUint256(
            uint256(KeyPrefix.distribution),
            _token
        );
        _S.setUint256(_ptKey(KeyPrefix.distribution, _token), dist.add(totalAmount));

        // allocate round id
        roundId = getStateVariableTokenUint256(
            uint256(KeyPrefix.roundCount),
            _token
        );
        _S.setUint256(_ptKey(KeyPrefix.roundCount, _token), roundId.add(1));

        uint256 nowT = block.timestamp;
        uint256 claimableFrom = nowT.add(_claimDelay());
        uint256 expiresAt = nowT.add(_roundExpiry());

        _S.setUint256(_rKey(KeyPrefix.roundTotalAmount, _token, roundId), totalAmount);
        _S.setUint256(_rKey(KeyPrefix.roundSupplySnapshot, _token, roundId), supply);
        _S.setUint256(_rKey(KeyPrefix.roundCreatedAt, _token, roundId), nowT);
        _S.setUint256(_rKey(KeyPrefix.roundClaimableFrom, _token, roundId), claimableFrom);
        _S.setUint256(_rKey(KeyPrefix.roundExpiresAt, _token, roundId), expiresAt);
        _S.setUint256(_ptKey(KeyPrefix.lastRoundCreatedAt, _token), nowT);

        // pay commission to treasury (state already set: reentrancy-safe)
        if (commission > 0) {
            _transferOut(_token, getTreasuryAddress(), commission);
        }

        emit DistributionRoundCreated(
            _token,
            roundId,
            totalAmount,
            supply,
            commission,
            claimableFrom,
            expiresAt
        );
    }

    /**
     * create a new distribution round for `_token`. O(1): snapshots the
     * unallocated balance and participation-token supply; no per-holder loop.
     * Reward pools are owner-only (see {distributePermissions}).
     */
    function createDistribution(
        address _token
    ) external distributePermissions returns (uint256 roundId) {
        if (!_canCreateDistribution(_token)) {
            revert DistributionTooSoon();
        }
        return _doCreateDistribution(_token);
    }

    //******************************* */
    // claim (O(1) per user)

    function _roundExists(
        address _token,
        uint256 _roundId
    ) internal view returns (bool) {
        return
            _roundId <
            getStateVariableTokenUint256(uint256(KeyPrefix.roundCount), _token);
    }

    function _computeClaim(
        address _shareholder,
        address _token,
        uint256 _roundId
    ) internal view returns (uint256) {
        uint256 supply = _S.getUint256(
            _rKey(KeyPrefix.roundSupplySnapshot, _token, _roundId)
        );
        if (supply == 0) {
            return 0;
        }
        uint256 bal = IERC20(getParticipationToken()).balanceOf(_shareholder);
        uint256 totalAmount = _S.getUint256(
            _rKey(KeyPrefix.roundTotalAmount, _token, _roundId)
        );
        return totalAmount.mul(bal).div(supply);
    }

    function _isClaimable(
        address _shareholder,
        address _token,
        uint256 _roundId
    ) internal view returns (bool) {
        if (!_roundExists(_token, _roundId)) {
            return false;
        }
        if (_S.getBool(_rcKey(KeyPrefix.roundClaimed, _token, _roundId, _shareholder))) {
            return false;
        }
        uint256 nowT = block.timestamp;
        if (nowT < _S.getUint256(_rKey(KeyPrefix.roundClaimableFrom, _token, _roundId))) {
            return false;
        }
        if (nowT > _S.getUint256(_rKey(KeyPrefix.roundExpiresAt, _token, _roundId))) {
            return false;
        }
        return _computeClaim(_shareholder, _token, _roundId) > 0;
    }

    /**
     * internal claim effects + transfer. Caller guarantees eligibility.
     */
    function _doClaim(
        address _shareholder,
        address _token,
        uint256 _roundId
    ) internal returns (uint256 amount) {
        amount = _computeClaim(_shareholder, _token, _roundId);

        // effects before interaction (reentrancy-safe)
        _S.setBool(
            _rcKey(KeyPrefix.roundClaimed, _token, _roundId, _shareholder),
            true
        );
        uint256 claimed = _S.getUint256(
            _rKey(KeyPrefix.roundTotalClaimed, _token, _roundId)
        );
        _S.setUint256(
            _rKey(KeyPrefix.roundTotalClaimed, _token, _roundId),
            claimed.add(amount)
        );
        uint256 dist = getStateVariableTokenUint256(
            uint256(KeyPrefix.distribution),
            _token
        );
        _S.setUint256(_ptKey(KeyPrefix.distribution, _token), dist.sub(amount));

        _transferOut(_token, _shareholder, amount);
        emit Claimed(_token, _roundId, _shareholder, amount);
    }

    /**
     * claim `_shareholder`'s pro-rata share of a round. Permissionless: anyone
     * may trigger it, funds always go to `_shareholder`. Reverts if ineligible.
     */
    function claim(
        address _shareholder,
        address _token,
        uint256 _roundId
    ) public returns (uint256) {
        if (!_roundExists(_token, _roundId)) {
            revert RoundNotFound();
        }
        if (_S.getBool(_rcKey(KeyPrefix.roundClaimed, _token, _roundId, _shareholder))) {
            revert AlreadyClaimed();
        }
        if (
            block.timestamp <
            _S.getUint256(_rKey(KeyPrefix.roundClaimableFrom, _token, _roundId))
        ) {
            revert ClaimWindowNotOpen();
        }
        if (
            block.timestamp >
            _S.getUint256(_rKey(KeyPrefix.roundExpiresAt, _token, _roundId))
        ) {
            revert RoundExpired();
        }
        if (_computeClaim(_shareholder, _token, _roundId) == 0) {
            revert NothingToClaim();
        }
        return _doClaim(_shareholder, _token, _roundId);
    }

    /**
     * claim multiple rounds for `_token` in one tx. Ineligible rounds (already
     * claimed, not open, expired, zero amount) are SKIPPED, so one stale id
     * cannot block the batch. Bounded by the caller-supplied `_roundIds`.
     */
    function claimBatch(
        address _shareholder,
        address _token,
        uint256[] calldata _roundIds
    ) external returns (uint256 totalClaimed) {
        for (uint256 i = 0; i < _roundIds.length; i++) {
            if (_isClaimable(_shareholder, _token, _roundIds[i])) {
                totalClaimed = totalClaimed.add(
                    _doClaim(_shareholder, _token, _roundIds[i])
                );
            }
        }
        if (totalClaimed == 0) {
            revert NothingClaimed();
        }
    }

    //******************************* */
    // reclaim expired round (admin)

    function reclaimExpiredRound(
        address _token,
        uint256 _roundId
    ) external isAdmin returns (uint256 remainder) {
        if (!_roundExists(_token, _roundId)) {
            revert RoundNotFound();
        }
        if (
            block.timestamp <=
            _S.getUint256(_rKey(KeyPrefix.roundExpiresAt, _token, _roundId))
        ) {
            revert RoundNotExpired();
        }
        if (_S.getBool(_rKey(KeyPrefix.roundReclaimed, _token, _roundId))) {
            revert AlreadyReclaimed();
        }

        uint256 totalAmount = _S.getUint256(
            _rKey(KeyPrefix.roundTotalAmount, _token, _roundId)
        );
        uint256 claimed = _S.getUint256(
            _rKey(KeyPrefix.roundTotalClaimed, _token, _roundId)
        );
        remainder = totalAmount.sub(claimed);
        if (remainder == 0) {
            revert NothingToReclaim();
        }

        // effects
        _S.setBool(_rKey(KeyPrefix.roundReclaimed, _token, _roundId), true);
        uint256 dist = getStateVariableTokenUint256(
            uint256(KeyPrefix.distribution),
            _token
        );
        _S.setUint256(_ptKey(KeyPrefix.distribution, _token), dist.sub(remainder));

        // unclaimed funds go back to the pool owner
        _transferOut(_token, owner(), remainder);
        emit RoundReclaimed(_token, _roundId, remainder);
    }

    //******************************* */
    // distribution config

    function setDistributionConfig(
        uint256 _minIntervalSeconds,
        uint256 _claimDelaySeconds,
        uint256 _roundExpirySeconds
    ) external onlyOwner {
        if (_roundExpirySeconds == 0) {
            revert ExpiryMustBePositive();
        }
        _S.setUint256(_pKey(KeyPrefix.minIntervalSeconds), _minIntervalSeconds);
        _S.setUint256(_pKey(KeyPrefix.claimDelaySeconds), _claimDelaySeconds);
        _S.setUint256(_pKey(KeyPrefix.roundExpirySeconds), _roundExpirySeconds);
        _S.setBool(_pKey(KeyPrefix.distConfigSet), true);
        emit DistributionConfigUpdated(
            _minIntervalSeconds,
            _claimDelaySeconds,
            _roundExpirySeconds
        );
    }

    /**
     * update the distribution commission. Only the current commission
     * recipient (the treasury address) may change it — not the pool owner.
     */
    function setDistributionCommission(uint256 _bps) external {
        if (msg.sender != getTreasuryAddress()) {
            revert OnlyCommissionRecipient();
        }
        if (_bps > MAX_COMMISSION_BPS) {
            revert CommissionTooHigh();
        }
        _S.setUint256(_pKey(KeyPrefix.distCommissionBps), _bps);
        _S.setBool(_pKey(KeyPrefix.distCommissionSet), true);
        emit DistributionCommissionUpdated(msg.sender, _bps);
    }

    // NOTE: auto-scheduling is handled OFF-CHAIN. The backend / PM2 EVM-sync
    // poller calls `createDistribution` on a cron, mirroring how Stellar
    // distributions are triggered. Keeping scheduling off-chain keeps the
    // deployed bytecode under the EIP-170 24KB limit. The sched* KeyPrefix
    // entries remain reserved (append-only) for a future on-chain scheduler.

    //******************************* */
    // getters

    function getRoundCount(address _token) external view returns (uint256) {
        return
            getStateVariableTokenUint256(uint256(KeyPrefix.roundCount), _token);
    }

    function getRound(
        address _token,
        uint256 _roundId
    )
        external
        view
        returns (
            uint256 totalAmount,
            uint256 totalSupplySnapshot,
            uint256 createdAt,
            uint256 claimableFrom,
            uint256 expiresAt,
            uint256 totalClaimed,
            bool reclaimed
        )
    {
        if (!_roundExists(_token, _roundId)) {
            revert RoundNotFound();
        }
        totalAmount = _S.getUint256(_rKey(KeyPrefix.roundTotalAmount, _token, _roundId));
        totalSupplySnapshot = _S.getUint256(_rKey(KeyPrefix.roundSupplySnapshot, _token, _roundId));
        createdAt = _S.getUint256(_rKey(KeyPrefix.roundCreatedAt, _token, _roundId));
        claimableFrom = _S.getUint256(_rKey(KeyPrefix.roundClaimableFrom, _token, _roundId));
        expiresAt = _S.getUint256(_rKey(KeyPrefix.roundExpiresAt, _token, _roundId));
        totalClaimed = _S.getUint256(_rKey(KeyPrefix.roundTotalClaimed, _token, _roundId));
        reclaimed = _S.getBool(_rKey(KeyPrefix.roundReclaimed, _token, _roundId));
    }

    /**
     * claimable amount for `_shareholder` in a round (0 if not eligible).
     */
    function getClaimable(
        address _shareholder,
        address _token,
        uint256 _roundId
    ) external view returns (uint256) {
        if (!_isClaimable(_shareholder, _token, _roundId)) {
            return 0;
        }
        return _computeClaim(_shareholder, _token, _roundId);
    }

    function hasClaimed(
        address _shareholder,
        address _token,
        uint256 _roundId
    ) external view returns (bool) {
        return
            _S.getBool(
                _rcKey(KeyPrefix.roundClaimed, _token, _roundId, _shareholder)
            );
    }

    function getDistributionConfigV2()
        external
        view
        returns (
            uint256 minIntervalSeconds,
            uint256 claimDelaySeconds,
            uint256 roundExpirySeconds,
            uint256 distributionCommissionBps,
            bool configSet
        )
    {
        minIntervalSeconds = _minInterval();
        claimDelaySeconds = _claimDelay();
        roundExpirySeconds = _roundExpiry();
        distributionCommissionBps = _distCommissionBps();
        configSet = _distConfigSet();
    }

    //******************************* */
    // interface read stubs (required by DistributionPoolInterface)

    function getDistributionDates(
        address _token
    )
        external
        view
        returns (
            uint256 firstDistributionDate,
            uint256 nDistributions,
            uint256 distributionInterval,
            uint256 index
        )
    {
        firstDistributionDate = _S.getUint256(_ptKey(KeyPrefix.firstDistributionDate, _token));
        nDistributions = _S.getUint256(_ptKey(KeyPrefix.nDistributions, _token));
        distributionInterval = _S.getUint256(_ptKey(KeyPrefix.distributionInterval, _token));
        index = _S.getUint256(_ptKey(KeyPrefix.index, _token));
    }

    function getDistributionAmounts(
        address token,
        uint256
    )
        external
        view
        returns (uint256 gasCost, uint256 commissionValue, uint256 efectiveValue)
    {
        uint256 total = getTotalDistAmount(token);
        commissionValue = total.mul(_distCommissionBps()).div(10000);
        efectiveValue = total.sub(commissionValue);
        gasCost = 0;
    }
}
