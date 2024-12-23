// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../../interface/staking/SimpleLockedStakingInterface.sol";
import "../../types/StakingConfig.sol";
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


    StakingConfigUsage private _config;

    /**
     * @dev in theory the contract allows different tokens for staking and
     *      rewards, however the testing functionality is only
     *      for same stake and reward tokens.
     */
    ERC20 private immutable _stakeToken;
    ERC20 private immutable _rewardToken;

    //////////////////////////////////
    // events
    //////////////////////////////////
    event ConfigUpdate(bytes32 key, uint256 newTokensForReward);
    event ConfigSet(
        bytes32 key,
        uint256 dprOpver10kk,
        uint256 tokensForRewards,
        uint256 lockPeriodDuration,
        uint256 depositPeriodDuration,
        uint256 startDate
    );
    event StakeTokens(bytes32 key, address user, uint256 amount);
    event ClaimTokens(
        bytes32 key,
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
        bytes32 _configId,
        uint256 _amount
    ) external override nonReentrant {
        require(
            getConfigState(0) == ConfigState.Opened,
            "config must be in state Opened"
        );
        uint256 maxStake = getMaxStakeToken(0);
        require(
            _config._totalStaked + _amount <= maxStake,
            "cannot stake more than the allowed amount"
        );
        _stakeToken.safeTransferFrom(msg.sender, address(this), _amount);

        // update variables
        _config._stakedPerUser[msg.sender] += _amount;
        _config._totalStaked += _amount;
        _config._activeUsersCounter++;
        emit StakeTokens(0, msg.sender, _amount);
    }

    function claim(bytes32 _configId) external override nonReentrant {
        require(
            getConfigState(0) == ConfigState.Completed,
            "config must be in state Completed"
        );
        uint256 stakedAmount = _config._stakedPerUser[msg.sender];
        require(stakedAmount > 0, "user does not have staked tokens");
        uint256 expectedReward = estimateConfigRewards(0, stakedAmount);
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
        _config._stakedPerUser[msg.sender] = 0;
        _config._totalStaked -= stakedAmount;
        _config._claimedRewards += expectedReward;
        _config._activeUsersCounter--;
        emit ClaimTokens(0, msg.sender, stakedAmount, expectedReward);
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
    ) external override onlyOwner returns (bytes32) {
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
        _config.config = config;
        emit ConfigSet(
            0,
            config.dprOver10kk,
            config.tokensForRewards,
            config.lockPeriodDuration,
            config.depositPeriodDuration,
            config.startDate
        );
        return 0;
    }

    function updateStakingConfig(
        bytes32 key,
        uint256 tokensForRewards
    ) external override onlyOwner {
        ConfigState state = getConfigState(0);
        require(
            state == ConfigState.PreOpened || state == ConfigState.Opened,
            "to update, config can only be PreOpened or Opened"
        );
        uint256 currentBalance_ = _rewardToken.balanceOf(address(this));
        uint256 currentLocked_ = getTotalLockedTokens();
        // substract the current tokensForRewards
        currentLocked_ -= _config.config.tokensForRewards;
        // add the new propossed tokensForRewads
        currentLocked_ += tokensForRewards;
        // check that we can lock that amount;
        require(
            currentLocked_ <= currentBalance_,
            "cannot update tokensForRewards, not enough balance to lock"
        );
        // check that the new tokensForRewards can cover the currently staked rewards;
        require(
            tokensForRewards >= estimateConfigTotalRewards(0),
            "cannot update tokensForReward, new ballance would be lower than required based on staked amount."
        );
        // update
        _config.config.tokensForRewards = tokensForRewards;
        emit ConfigUpdate(0, tokensForRewards);
    }

    //////////////////////////////////
    // getter functions
    //////////////////////////////////

    function getStakingConfig(
        bytes32 key
    ) public view override returns (StakingConfig memory) {
        return _config.config;
    }

    function getConfigKey(
        StakingConfig memory config
    ) public pure override returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    config.dprOver10kk,
                    config.lockPeriodDuration,
                    config.depositPeriodDuration,
                    config.startDate
                )
            );
    }

    function getConfigUsageData(
        bytes32 key
    )
        external
        view
        override
        returns (
            uint256 activeUsersCount,
            uint256 totalStaked,
            uint256 totalClaimed
        )
    {
        StakingConfigUsage storage usage = _config;
        activeUsersCount = usage._activeUsersCounter;
        totalStaked = usage._totalStaked;
        totalClaimed = usage._claimedRewards;
    }

    function getConfigStakedAmount(
        bytes32 key
    ) public view override returns (uint256) {
        return _config._totalStaked;
    }

    function getConfigUserStakedAmount(
        bytes32 key,
        address user
    ) public view override returns (uint256) {
        return _config._stakedPerUser[user];
    }

    function getTotalLockedStakedAmount()
        public
        view
        override
        returns (uint256)
    {
        return getConfigStakedAmount(0);
    }

    function getTotalLockedRewards() public view override returns (uint256) {
        // if state is [PreOpened, Opened]
        ConfigState state = getConfigState(0);
        if (state == ConfigState.PreOpened || state == ConfigState.Opened) {
            // use tokensForRewards
            return _config.config.tokensForRewards;
        } else {
            // case phase >= 0 (in [2,3])
            // use formula
            return estimateConfigTotalRewards(0);
        }
    }

    function getConfigState(
        bytes32 key
    ) public view override returns (ConfigState) {
        if (isNotSet(0)) return ConfigState.NotSet;
        else if (isPreOpened(0)) return ConfigState.PreOpened;
        else if (isOpened(0)) return ConfigState.Opened;
        else if (isLocked(0)) return ConfigState.Locked;
        else return ConfigState.Completed;
    }


    function isNotSet(bytes32 key) public view override returns (bool) {
        return _config.config.startDate == 0;
    }

    function isPreOpened(bytes32 key) public view override returns (bool) {
        return block.timestamp < _config.config.startDate;
    }

    function isOpened(bytes32 key) public view override returns (bool) {
        uint256 ts_ = block.timestamp;
        StakingConfig memory config = getStakingConfig(0);
        return
            config.startDate <= ts_ &&
            ts_ < config.startDate + config.depositPeriodDuration;
    }

    function isLocked(bytes32 key) public view override returns (bool) {
        uint256 ts_ = block.timestamp;
        StakingConfig memory config = getStakingConfig(0);
        return
            config.startDate + config.depositPeriodDuration <= ts_ &&
            ts_ <
            config.startDate +
                config.depositPeriodDuration +
                config.lockPeriodDuration;
    }

    function isCompleted(bytes32 key) public view override returns (bool) {
        StakingConfig memory config = getStakingConfig(0);
        return
            config.startDate +
                config.depositPeriodDuration +
                config.lockPeriodDuration <=
            block.timestamp;
    }

    function estimateConfigRewards(
        bytes32 key,
        uint256 stakedAmount
    ) public view override returns (uint256 expectedReward) {
        if (isPreOpened(key) || isNotSet(key)) return 0;
        StakingConfig memory config_ = getStakingConfig(key);
        uint256 lockDays_ = config_.lockPeriodDuration / 86400;

        uint256 rewardsToBe_ = config_.dprOver10kk * lockDays_ * stakedAmount;

        if (rewardsToBe_ % 100000 != 0) {
            rewardsToBe_ -= rewardsToBe_ % 100000;
        }

        if (rewardsToBe_ == 0) {
            return 0;
        }
        return rewardsToBe_ / 100000;
    }

    function estimateConfigTotalRewards(
        bytes32 key
    ) public view override returns (uint256) {
        return estimateConfigRewards(key, _config._totalStaked);
    }

    function estimateConfigUserRewards(
        bytes32 key,
        address user
    ) external view override returns (uint256) {
        return estimateConfigRewards(key, _config._stakedPerUser[user]);
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

    function getMaxStakeToken(
        bytes32 key
    ) public view override returns (uint256 maxStake) {
        if (isNotSet(key)) return maxStake;
        StakingConfig memory config = getStakingConfig(key);
        maxStake = config.tokensForRewards * 10000000;
        // remember to transform lockPeriodDuration from seconds to days.
        uint256 residual = maxStake %
            ((config.dprOver10kk * config.lockPeriodDuration) / 86400);
        if (residual != 0) {
            maxStake -= residual;
            if (maxStake == 0) return maxStake;
        }
        maxStake =
            maxStake /
            ((config.dprOver10kk * config.lockPeriodDuration) / 86400);
        return maxStake;
    }
}
