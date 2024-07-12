// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../../interface/staking/LockedStakingInterface.sol";
import "../../types/StakingConfig.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

import "./utils/ArrayBytes32.sol";

contract LockedStaking is Ownable, LockedStakingInterface, ReentrancyGuard {
    /**
     * @dev
     *
     * notes:
     * * i dont need to know what are the currently active configurations
     *  that info is emitted through events
     */
    using SafeERC20 for ERC20;
    using ArrayBytes32 for bytes32[];

    mapping(bytes32 => StakingConfigUsage) private configs;
    /**
     * @notice we need the configKeys list so we can compute
     *      live-changes based on time-changes and not in user-actions
     *      such as live-update of locked token amounts when a config
     *      transitions from state Opened to Locked.
     *      this will save us gas cost in user interactions
     *      but will increase gas cost in admin/owner interactions.
     */
    bytes32[] public configKeys;

    ERC20 private immutable _stakeToken;
    ERC20 private immutable _rewardToken;

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

    /**
     * perfom the transfer of tokens from a user to the contract
     * and asign that amount as staked to the specific config
     *
     * This function requires a previously invoked approve()
     *
     * Stake can only be made to configurations that are
     * in state Open.
     *
     * Stake is allowed only if the config has room for it.
     *
     *
     * @param _configId the config id to stake to
     * @param _amount the amount to stake
     */
    function stake(
        bytes32 _configId,
        uint256 _amount
    ) external override nonReentrant {
        require(
            getConfigState(_configId) == ConfigState.Opened,
            "config must be in state Opened"
        );
        StakingConfigUsage storage config = configs[_configId];
        uint256 maxStake = getMaxStakeToken(_configId);
        require(
            config._totalStaked + _amount <= maxStake,
            "cannot stake more than the allowed amount"
        );
        _stakeToken.safeTransferFrom(msg.sender, address(this), _amount);

        // update variables
        config._stakedPerUser[msg.sender] += _amount;
        config._totalStaked += _amount;
        config._activeUsersCounter++;
    }

    /**
     * withdraw staked tokens and rewards from a config
     * the config must be completed
     * @param _configId the config id to withdraw from
     */
    function claim(bytes32 _configId) external override nonReentrant {
        require(
            getConfigState(_configId) == ConfigState.Completed,
            "config must be in state Completed"
        );
        StakingConfigUsage storage config = configs[_configId];
        uint256 stakedAmount = config._stakedPerUser[msg.sender];
        require(stakedAmount > 0, "user does not have staked tokens");
        uint256 expectedReward = estimateConfigRewards(_configId, stakedAmount);
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
        config._stakedPerUser[msg.sender] = 0;
        config._totalStaked -= stakedAmount;
        config._claimedRewards += expectedReward;
        config._activeUsersCounter--;
    }

    /**
     * withdraw staked tokens from a config
     * the config must be Opened, Locked or Dropped
     * @param _configId the config id to withdraw from
     */
    function earlyWithdraw(bytes32 _configId) external override nonReentrant {
        StakingConfigUsage storage config = configs[_configId];
        ConfigState state = getConfigState(_configId);
        require(
            state == ConfigState.Opened ||
                state == ConfigState.Locked ||
                state == ConfigState.Dropped,
            "config must be in state [Opened, Locked, Dropped]"
        );
        uint256 stakedAmount = config._stakedPerUser[msg.sender];
        require(stakedAmount > 0, "user has no staked tokens");
        _safeTransfer(_stakeToken, msg.sender, stakedAmount);

        // update variables
        config._stakedPerUser[msg.sender] = 0;
        config._totalStaked -= stakedAmount;
        config._activeUsersCounter--;
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
    }

    //////////////////////////////////
    // config functions
    //////////////////////////////////

    function setStakingConfig(
        StakingConfig memory config
    ) external override onlyOwner returns (bytes32) {
        /**
         * set a new configuration for staking
         *
         * conditions:
         *
         * - lockPeriodDuration and depositPeriodDurations must be integer days
         *      wich means, divisible by 86400
         * - config must be unique in the pairs
         *      (DRP, LockPeriod, DepositPeriod, startDate)
         * - balance should be enough to lock the required tokens.
         * - startPeriod must be at least 1 day in the future
         * - depositPeriodDuration must be at least 1 day
         * - lockPeriodDuration must be at least 1 week
         */
        bytes32 key_ = getConfigKey(config);
        require(!configActive(key_), "config already exists, cannot set");
        require(
            config.lockPeriodDuration > 86400 * 7,
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
        // console.log("block timestamp", block.timestamp);
        // console.log("startDate should be >=", block.timestamp + 86400 - 60);
        // we apply an offset of -60 seconds here, in case
        // const res = await _staking.functions.configKeys();
        // if everything checks, create the config
        configs[key_].config = config;
        configKeys.push(key_);
        // console.log("new configKeys list is:", configKeys.length);
        return key_;
    }

    function dropStakingConfig(bytes32 key) external override onlyOwner {
        /**
         * drop a staking config.
         * This does not remove the mapping data, just unlink that data from everything else
         * and perfom the necesarry actions to ensure no tokens are lost.
         *
         * sets the stakingConfigUsage.dropped to true;
         * this means that:
         *  - this config wont give rewards if it was in phase [3]
         *  - this config wont allow new deposits even if it was in phase [0,1]
         *
         * if you want to return the tokens to its owners you must use the function
         * distributeDroppedConfigTokens()
         *
         *
         * conditions:
         * * key must exists
         * * config must no be already dropped
         * * CAN ONLY BE USED BY THE OWNER
         *
         * @param key
         */
        require(configActive(key), "config not found");
        require(!configs[key].dropped, "config already dropped");
        console.log("[contract] dropping config");
        configs[key].dropped = true;
    }

    function flushOldConfigs() external override onlyOwner {
        /**
         * removes the indexes for the configs
         * that are already finished and empty.
         * A config is considered ready to flush when:
         *  - it is in state completed or dropped
         *  - it has no staked tokens
         *
         * the action to flush will only delete its index. The config data
         * can be still accessed through the mapping with the getter functions
         * if you know the key.
         *
         * This function is intended to free-up space in the internal list of indexes
         * in order to reduce potencial high-gas costs when the list grows too large.
         *
         */

        // find the indexes to remove
        uint256 l = configKeys.length;
        require(l > 0, "there is no config set");
        for (uint256 i = l; i > 0; i--) {
            bytes32 key = configKeys[i-1];
            ConfigState state = getConfigState(key);
            if (
                configs[key]._totalStaked == 0 &&
                (state == ConfigState.Dropped || state == ConfigState.Completed)
            ) {
                configKeys.removeByIndex(i-1);
            }
        }
    }

    function updateStakingConfig(
        bytes32 key,
        uint256 tokensForRewards
    ) external override onlyOwner {
        /**
         * conditions:
         * - state must be [PreOpened, Opened]
         * - check that there are enough tokens for the update
         * - check that the new tokensForRewards is enough to
         *      maintain the already staked tokens (if any)
         */
        ConfigState state = getConfigState(key);
        require(
            state == ConfigState.PreOpened || state == ConfigState.Opened,
            "to update, config can only be PreOpened or Opened"
        );
        uint256 currentBalance_ = _rewardToken.balanceOf(address(this));
        uint256 currentLocked_ = getTotalLockedTokens();
        // substract the current tokensForRewards
        currentLocked_ -= configs[key].config.tokensForRewards;
        // add the new propossed tokensForRewads
        currentLocked_ += tokensForRewards;
        // check that we can lock that amount;
        require(
            currentLocked_ <= currentBalance_,
            "cannot update tokensForRewards, not enough balance to lock"
        );
        // check that the new tokensForRewards can cover the currently staked rewards;
        require(
            tokensForRewards >= estimateConfigTotalRewards(key),
            "cannot update tokensForReward, new ballance would be lower than required based on staked amount."
        );
        // update
        configs[key].config.tokensForRewards = tokensForRewards;
    }

    //////////////////////////////////
    // getter functions
    //////////////////////////////////

    function getStakingConfig(
        bytes32 key
    ) public view override returns (StakingConfig memory) {
        return configs[key].config;
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
        returns (
            uint256 activeUsersCount,
            uint256 totalStaked,
            uint256 totalClaimed
        )
    {
        StakingConfigUsage storage usage = configs[key];
        activeUsersCount = usage._activeUsersCounter;
        totalStaked = usage._totalStaked;
        totalClaimed = usage._claimedRewards;
    }

    function getConfigStakedAmount(bytes32 key) public view returns (uint256) {
        return configs[key]._totalStaked;
    }

    function getConfigUserStakedAmount(
        bytes32 key,
        address user
    ) public view returns (uint256) {
        return configs[key]._stakedPerUser[user];
    }

    function getTotalLockedStakedAmount()
        public
        view
        override
        returns (uint256)
    {
        uint256 total_ = 0;
        for (uint256 i_ = 0; i_ < configKeys.length; i_++) {
            total_ += getConfigStakedAmount(configKeys[i_]);
        }
        return total_;
    }

    function getTotalLockedRewards() public view override returns (uint256) {
        uint256 total_ = 0;
        for (uint256 i_ = 0; i_ < configKeys.length; i_++) {
            bytes32 key_ = configKeys[i_];
            // if state is [PreOpened, Opened]
            ConfigState state = getConfigState(key_);
            console.log("[contract] config state", uint256(state));
            if (state == ConfigState.PreOpened || state == ConfigState.Opened) {
                // use tokensForRewards
                console.log("[contract] using tokensForEwards", configs[key_].config.tokensForRewards);
                total_ += configs[key_].config.tokensForRewards;
            } else {
                // case phase >= 0 (in [2,3])
                // use formula
                console.log("[contract] using formula from staked tokens: ", estimateConfigTotalRewards(key_));
                total_ += estimateConfigTotalRewards(key_);
            }
        }
        return total_;
    }

    /**
     * return the config current state
     *
     * @param key the config key
     */
    function getConfigState(
        bytes32 key
    ) public view override returns (ConfigState) {
        if (isDropped(key)) return ConfigState.Dropped;
        else if (isNotSet(key)) return ConfigState.NotSet;
        else if (isPreOpened(key)) return ConfigState.PreOpened;
        else if (isOpened(key)) return ConfigState.Opened;
        else if (isLocked(key)) return ConfigState.Locked;
        else return ConfigState.Completed;
    }

    function isDropped(bytes32 key) public view returns (bool) {
        return configs[key].dropped;
    }

    function isNotSet(bytes32 key) public view returns (bool) {
        return configs[key].config.startDate == 0;
    }

    function isPreOpened(bytes32 key) public view returns (bool) {
        return block.timestamp < configs[key].config.startDate;
    }

    function isOpened(bytes32 key) public view returns (bool) {
        uint256 ts_ = block.timestamp;
        StakingConfig memory config = getStakingConfig(key);
        return
            config.startDate <= ts_ &&
            ts_ < config.startDate + config.depositPeriodDuration;
    }

    function isLocked(bytes32 key) public view returns (bool) {
        uint256 ts_ = block.timestamp;
        StakingConfig memory config = getStakingConfig(key);
        return
            config.startDate + config.depositPeriodDuration <= ts_ &&
            ts_ <
            config.startDate +
                config.depositPeriodDuration +
                config.lockPeriodDuration;
    }

    function isCompleted(bytes32 key) public view returns (bool) {
        StakingConfig memory config = getStakingConfig(key);
        return
            config.startDate +
                config.depositPeriodDuration +
                config.lockPeriodDuration <=
            block.timestamp;
    }

    function estimateConfigRewards(
        bytes32 key,
        uint256 stakedAmount
    ) public view returns (uint256 expectedReward) {
        if (isDropped(key) || isPreOpened(key) || isNotSet(key)) return 0;
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
    ) public view returns (uint256) {
        return estimateConfigRewards(key, configs[key]._totalStaked);
    }

    function estimateConfigUserRewards(
        bytes32 key,
        address user
    ) external view returns (uint256) {
        return estimateConfigRewards(key, configs[key]._stakedPerUser[user]);
    }

    function configActive(bytes32 key) public view override returns (bool) {
        return configKeys.exists(key);
    }

    function getTotalLockedTokens() public view override returns (uint256) {
        console.log("[contract] number of active configs", configKeys.length);
        uint256 currentLocked_ = getTotalLockedRewards();
        console.log("[contract] total locked rewards:", currentLocked_);
        if (address(_rewardToken) == address(_stakeToken)) {
            currentLocked_ += getTotalLockedStakedAmount();
        }
        return currentLocked_;
    }

    function isSameTokenForRewardStake() public view returns (bool) {
        return address(_rewardToken) == address(_stakeToken);
    }

    /**
     * use the formula
     *
     * tokensForRewards * 10000000 / (DPR * maxDays)
     *
     * make sure to handle trunctations
     *
     * @param key the configuration key to get the maxStakeTokens from
     */
    function getMaxStakeToken(
        bytes32 key
    ) public view returns (uint256 maxStake) {
        if (isNotSet(key) || isDropped(key)) return maxStake;
        StakingConfig memory config = configs[key].config;
        maxStake = config.tokensForRewards * 10000000;
        uint256 residual = maxStake %
            (config.dprOver10kk * config.lockPeriodDuration);
        if (residual != 0) {
            maxStake -= residual;
            if (maxStake == 0) return maxStake;
        }
        maxStake = maxStake / (config.dprOver10kk * config.lockPeriodDuration);
        return maxStake;
    }

    function getNumberOfActiveConfigs() public view returns(uint256){
        return configKeys.length;
    }
}
