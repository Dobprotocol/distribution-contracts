// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../../interface/staking/SimpleLockedStakingInterface.sol";
import "../../types/SimpleStakingConfig.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// import "hardhat/console.sol";

import "./utils/ArrayBytes32.sol";



contract SimpleLockedStaking is Ownable, SimpleLockedStakingInterface, ReentrancyGuard {
    /**
     * @dev for detailed documentation on each function,
     * go to interface LockedStakingInterface
     *
     */
    using SafeERC20 for ERC20;
    using ArrayBytes32 for bytes32[];

    /**
     * @dev in theory the contract allows different tokens for staking and
     *      rewards, however the testing functionality is only
     *      for same stake and reward tokens.
     */
    ERC20 private immutable _stakeToken;
    ERC20 private immutable _rewardToken;


    // metrics
    uint256 _activeUsersCounter;
    uint256 _totalStaked;
    uint256 _claimedRewards;
    mapping(address => uint256) _stakedPerUser;

    // config
    StakingConfig private config_;
    uint256 private constant REWARD_FACTOR = 10000;

    //////////////////////////////////
    // events
    //////////////////////////////////
    event ConfigSet(
        uint256 rewardRateOver10k,
        uint256 tokensForRewards,
        uint256 lockPeriodDuration,
        uint256 depositPeriodDuration,
        uint256 startDate
    );
    event StakeTokens(address user, uint256 amount);
    event ClaimTokens(
        address user,
        uint256 amountStake,
        uint256 amountReward
    );
    event WithdrawRemains(uint256 amount);

    constructor(ERC20 stakingToken, ERC20 rewardsToken) {
        _stakeToken = stakingToken;
        _rewardToken = rewardsToken;
    }

    //////////////////////////////////
    // internal functions
    //////////////////////////////////

    function _safeTransfer(ERC20 token, address to, uint256 amount) internal {
        // do i really need this require() if using safeTransfer()???
        require(
            token.balanceOf(address(this)) >= amount,
            "not enough tokens to transfer"
        );
        token.safeTransfer(to, amount);
    }

    //////////////////////////////////
    // deposit/withdraw functions
    //////////////////////////////////

    function stake(
        uint256 _amount
    ) external override nonReentrant {
        require(
            getConfigState() == ConfigState.Opened,
            "config must be in state Opened"
        );
        uint256 maxStake = getMaxStakeToken();
        require(
            _totalStaked + _amount <= maxStake,
            "cannot stake more than the allowed amount"
        );
        _stakeToken.safeTransferFrom(msg.sender, address(this), _amount);

        // update variables
        _stakedPerUser[msg.sender] += _amount;
        _totalStaked += _amount;
        _activeUsersCounter++;
        emit StakeTokens(msg.sender, _amount);
    }

    function claim() external override nonReentrant {
        require(
            getConfigState() == ConfigState.Completed,
            "config must be in state Completed"
        );
        uint256 stakedAmount = _stakedPerUser[msg.sender];
        require(stakedAmount > 0, "user does not have staked tokens");
        uint256 expectedReward = estimateConfigRewards(stakedAmount);
        if (isSameTokenForRewardStake()) {
            // same token, make only 1 transaction
            _safeTransfer(
                _stakeToken,
                msg.sender,
                stakedAmount + expectedReward
            );
        } else {
            // different token, make 2 transactions
            _safeTransfer(_stakeToken, msg.sender, stakedAmount);
            _safeTransfer(_rewardToken, msg.sender, expectedReward);
        }
        // make the variables updates
        _stakedPerUser[msg.sender] = 0;
        _totalStaked -= stakedAmount;
        _claimedRewards += expectedReward;
        _activeUsersCounter--;
        emit ClaimTokens(msg.sender, stakedAmount, expectedReward);
    }

    /**
     * withdraw any non-locked token
     */
    function withdrawRemains() external override onlyOwner nonReentrant {
        // the locked tokens are
        // totalStaked + totalClaimableRewards
        uint256 lockedTokens = getTotalLockedTokens();
        // we need to subtract that from the balance
        uint256 balance = _rewardToken.balanceOf(address(this));
        require(
            balance >= lockedTokens,
            "balace is lower than the locked tokens, warning!!!"
        );
        uint256 withdrawTokens = balance - lockedTokens;
        require(withdrawTokens > 0, "no tokens available to withdraw");
        _safeTransfer(_rewardToken, msg.sender, withdrawTokens);
        emit WithdrawRemains(withdrawTokens);
    }

    //////////////////////////////////
    // config functions
    //////////////////////////////////

    function setStakingConfig(
        StakingConfig memory config
    ) external override onlyOwner {
        require(
            config.lockPeriodDuration >= 86400 * 7,
            "lockPeriodDuration must be at least 1 week"
        );
        require(
            config.depositPeriodDuration >= 86400,
            "depositPeriodDuration must be at least 1 day"
        );
        require(
            config.lockPeriodDuration % 86400 == 0,
            "LockPeriodDuration must be divisible by 86400"
        );
        require(
            config.depositPeriodDuration % 86400 == 0,
            "depositPeriodDuration must be divisible by 86400"
        );
        uint256 balance = _rewardToken.balanceOf(address(this));
        uint256 lockedTokens = getTotalLockedTokens();
        require(
            balance >= lockedTokens + config.tokensForRewards,
            "not enough tokens in contract"
        );
        // if everything checks, create the config
        config_ = config;
        emit ConfigSet(
            config.rewardRateOver10k,
            config.tokensForRewards,
            config.lockPeriodDuration,
            config.depositPeriodDuration,
            config.startDate
        );
    }


    //////////////////////////////////
    // getter functions
    //////////////////////////////////

    function getConfigUsageData()
        external
        view
        override
        returns (
            uint256 activeUsersCount,
            uint256 totalStaked,
            uint256 totalClaimed
        )
    {
        activeUsersCount = _activeUsersCounter;
        totalStaked = _totalStaked;
        totalClaimed = _claimedRewards;
    }

    function getConfigStakedAmount() public view override returns (uint256) {
        return _totalStaked;
    }

    function getConfigUserStakedAmount(
        address user
    ) public view override returns (uint256) {
        return _stakedPerUser[user];
    }

    function getTotalLockedStakedAmount()
        public
        view
        override
        returns (uint256)
    {
        return getConfigStakedAmount();
    }

    function getTotalLockedRewards() public view override returns (uint256) {
        // if state is [PreOpened, Opened]
        ConfigState state = getConfigState();
        if (state == ConfigState.PreOpened || state == ConfigState.Opened) {
            // use tokensForRewards
            return config_.tokensForRewards;
        } else {
            // case phase >= 0 (in [2,3])
            // use formula
            return estimateConfigTotalRewards();
        }
    }

    function getConfigState() public view override returns (ConfigState) {
        if (isNotSet()) return ConfigState.NotSet;
        else if (isPreOpened()) return ConfigState.PreOpened;
        else if (isOpened()) return ConfigState.Opened;
        else if (isLocked()) return ConfigState.Locked;
        else return ConfigState.Completed;
    }


    function isNotSet() public view override returns (bool) {
        return config_.startDate == 0;
    }

    function isPreOpened() public view override returns (bool) {
        return block.timestamp < config_.startDate;
    }

    function isOpened() public view override returns (bool) {
        uint256 ts_ = block.timestamp;
        return
            config_.startDate <= ts_ &&
            ts_ < config_.startDate + config_.depositPeriodDuration;
    }

    function isLocked() public view override returns (bool) {
        uint256 ts_ = block.timestamp;
        return
            config_.startDate + config_.depositPeriodDuration <= ts_ &&
            ts_ <
            config_.startDate +
                config_.depositPeriodDuration +
                config_.lockPeriodDuration;
    }

    function isCompleted() public view override returns (bool) {
        return
            config_.startDate +
                config_.depositPeriodDuration +
                config_.lockPeriodDuration <=
            block.timestamp;
    }

    function estimateConfigRewards(
        uint256 stakedAmount
    ) public view override returns (uint256 expectedReward) {
        if (isPreOpened() || isNotSet()) return 0;


        uint256 rewardsToBe_ = config_.rewardRateOver10k * stakedAmount;

        if (rewardsToBe_ % REWARD_FACTOR != 0) {
            rewardsToBe_ -= rewardsToBe_ % REWARD_FACTOR;
        }

        if (rewardsToBe_ == 0) {
            return 0;
        }
        return rewardsToBe_ / REWARD_FACTOR;
    }

    function estimateConfigTotalRewards() public view override returns (uint256) {
        return estimateConfigRewards(_totalStaked);
    }

    function estimateConfigUserRewards(
        address user
    ) external view override returns (uint256) {
        return estimateConfigRewards(_stakedPerUser[user]);
    }

    function getTotalLockedTokens() public view override returns (uint256) {
        uint256 currentLocked_ = getTotalLockedRewards();
        if (isSameTokenForRewardStake()) {
            currentLocked_ += getTotalLockedStakedAmount();
        }
        return currentLocked_;
    }

    function isSameTokenForRewardStake() public view override returns (bool) {
        return address(_rewardToken) == address(_stakeToken);
    }

    function getMaxStakeToken() public view override returns (uint256 maxStake) {
        if (isNotSet()) return maxStake;
        maxStake = config_.tokensForRewards * REWARD_FACTOR;
        // remember to transform lockPeriodDuration from seconds to days.
        uint256 residual = maxStake % config_.rewardRateOver10k;
        if (residual != 0) {
            maxStake -= residual;
            if (maxStake == 0) return maxStake;
        }
        maxStake =
            maxStake / config_.rewardRateOver10k;
        return maxStake;
    }
}
