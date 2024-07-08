// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../../interface/staking/LockedStakingInterface.sol";
import "../../types/StakingConfig.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

// import "./utils/Array.sol";

contract LockedStaking is Ownable, LockedStakingInterface {
    /**
     * @dev
     *
     * notes:
     * * i dont need to know what are the currently active configurations
     *  that info is emitted through events
     */
    using SafeERC20 for ERC20;
    // using ArrayBytes32 for bytes32[];

    mapping(bytes32 => StakingConfigUsage) private configs;
    bytes32[] public configKeys;

    ERC20 private immutable _stakeToken;
    ERC20 private immutable _rewardToken;

    constructor(ERC20 stakingToken, ERC20 rewardsToken) {
        _stakeToken = stakingToken;
        _rewardToken = rewardsToken;
    }

    function stake(uint256 _configId, uint256 _amount) external override {}

    function claim(uint256 _configId) external override {}

    function earlyWithdraw(uint256 _configId) external override {}

    function withdrawRemains() external override onlyOwner {}

    function setStakingConfig(
        StakingConfig memory config
    ) external override onlyOwner returns(bytes32){
        /**
         * set a new configuration for staking
         *
         * conditions:
         *
         * - lockPeriodDuration and depositPeriodDurations must be integer days
         *      wich means, divisible by 86400
         * - config must be unique in the pairs (DRP, LockPeriod, DepositPeriod, startDate)
         * - balance should be enough to lock the required tokens.
         * - startPeriod must be at least 1 day in the future
         * - depositPeriodDuration must be at least 1 day
         * - lockPeriodDuration must be at least 1 week
         */
        bytes32 key_ = getConfigKey(config);
        require(!configExists(key_), "config already exists, cannot set");
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
        console.log("block timestamp", block.timestamp);
        console.log("startDate should be >=", block.timestamp + 86400 - 60);
        // we apply an offset of -60 seconds here, in case
        // const res = await _staking.functions.configKeys();
        // if everything checks, create the config
        configs[key_].config = config;
        configKeys.push(key_);
        console.log("new configKeys list is:", configKeys.length);
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
        require(configExists(key), "config not found");
        require(!configs[key].dropped, "config already dropped");
        configs[key].dropped = true;
    }

    function flushOldConfigs() external override onlyOwner {
        /**
         * removes the indexes for the configs
         * that are already finished and empty.
         * A config is considered ready to flush when:
         *  - it is in phase 3 or dropped
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
        // TODO: pending
        // remove the key from the list
        // uint256 index = findElementIndex(key);
        // if (index < configIds.length) {
        //     removeByIndex(index);
        // }
    }

    // Function to remove an element by index
    function removeByIndex(uint256 index) internal {
        require(index < configKeys.length, "Index out of bounds");

        for (uint256 i = index; i < configKeys.length - 1; i++) {
            configKeys[i] = configKeys[i + 1];
        }
        configKeys.pop();
    }

    // Function to find the index of an element in the array
    function findElementIndex(bytes32 element) internal view returns (uint256) {
        for (uint256 i = 0; i < configKeys.length; i++) {
            if (configKeys[i] == element) {
                return i;
            }
        }
        return configKeys.length; // Return array length if element is not found
    }

    function getStakingConfig(
        bytes32 key
    ) external view override returns (StakingConfig memory) {
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
            "to update, config cannot only be PreOpened or Opened"
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
            tokensForRewards >= estimateRemainingRewards(key),
            "cannot update tokensForReward, new ballance would be lower than required based on staked amount."
        );
        // update
        configs[key].config.tokensForRewards = tokensForRewards;
    }

    function getTotalLockedStakedAmount() public view override returns (uint256) {
        uint256 total_ = 0;
        for (uint256 i_ = 0; i_ < configKeys.length; i_++) {
            total_ += configs[configKeys[i_]]._totalStaked;
        }
        return total_;
    }

    function getTotalLockedRewards() public view override returns (uint256) {
        uint256 total_ = 0;
        for (uint256 i_ = 0; i_ < configKeys.length; i_++) {
            bytes32 key_ = configKeys[i_];
            // if state is [PreOpened, Opened]
            ConfigState state = getConfigState(key_);
            if (state == ConfigState.PreOpened || state == ConfigState.Opened) {
                // use tokensForRewards
                total_ += configs[key_].config.tokensForRewards;
            } else {
                // case phase >= 0 (in [2,3])
                // use formula
                total_ += estimateRemainingRewards(key_);
            }
        }
        return total_;
    }

    function getConfigState(bytes32 key) public view override returns (ConfigState) {
        /**
         * phases are:
         * 0: block.timestamp > startDate
         *      - config still does not start
         * 1: startDate <= block.timestamp < startDate + depositPeriodDuration
         *      - config is in deposit phase
         * 2: startDate + depositPeriodDuration <
         *  block.timestamp < startDate + depositPeriodDuration + lockPeriodDuration
         *      - config is in lock phase
         * 3: startDate + depositPeriodDuration + lockPeriodDuration <
         *  block.timestamp
         *      - config is complete and ready to give rewards
         * 4: dropped = True
         *      - if dropped, phase should be 4
         * 5: startDate = 0
         *      - config is "empty", not really set
         */
        uint256 ts_ = block.timestamp;
        StakingConfig memory config = configs[key].config;
        if (configs[key].dropped) return ConfigState.Dropped;
        else if (config.startDate == 0) return ConfigState.NotSet;
        else if (ts_ < config.startDate) return ConfigState.PreOpened;
        else if (
            config.startDate <= ts_ &&
            ts_ < config.startDate + config.depositPeriodDuration
        ) return ConfigState.Opened;
        else if (
            config.startDate + config.depositPeriodDuration <= ts_ &&
            ts_ <
            config.startDate +
                config.depositPeriodDuration +
                config.lockPeriodDuration
        ) return ConfigState.Locked;
        else return ConfigState.Completed;
    }

    function estimateRemainingRewards(
        bytes32 key
    ) public view override returns (uint256) {
        /**
         * estimates the amount of rewardsTokens required
         * based on the amount of tokens staked in the specific config.
         */
        if (configs[key].dropped) return 0;
        StakingConfig storage config_ = configs[key].config;
        uint256 lockDays_ = config_.lockPeriodDuration / 86400;

        uint256 rewardsToBe_ = config_.dprOver10kk *
            lockDays_ *
            configs[key]._totalStaked;

        if (rewardsToBe_ % 100000 != 0) {
            rewardsToBe_ -= rewardsToBe_ % 100000;
        }

        if (rewardsToBe_ == 0) {
            return 0;
        }
        return rewardsToBe_ / 100000;
    }

    function configExists(bytes32 key) public view override returns (bool) {
        for (uint256 i_ = 0; i_ < configKeys.length; i_++) {
            if (configKeys[i_] == key) return true;
        }
        return false;
    }

    function getTotalLockedTokens() public view override returns (uint256) {
        uint256 currentLocked_ = getTotalLockedRewards();
        if (address(_rewardToken) == address(_stakeToken)) {
            currentLocked_ += getTotalLockedStakedAmount();
        }
        return currentLocked_;
    }
}
