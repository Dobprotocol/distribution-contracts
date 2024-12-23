// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "../../types/StakingConfig.sol";

interface SimpleLockedStakingInterface {
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
     * @param _amount the amount to stake
     */
    function stake(uint256 _amount) external;

    /**
     * withdraw staked tokens and rewards from a config
     * the config must be completed
     */
    function claim() external;


    /**
     * withdraw any non-locked token
     *
     * - CAN ONLY BE USED BY THE OWNER
     */
    function withdrawRemains() external;

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
     * - startPeriod must be at least 1 day in the future,
     *      FROM THE BLOCK.TIMESTAMP
     * - depositPeriodDuration must be at least 1 day
     * - lockPeriodDuration must be at least 1 week
     * - CAN ONLY BE USED BY THE OWNER
     * @param config the config to be set
     */
    function setStakingConfig(
        StakingConfig memory config
    ) external;


    /**
     * update the amounts of tokens for rewards
     * asigned to this specific config.
     *
     * conditions:
     * - state must be [PreOpened, Opened]
     * - check that there are enough tokens for the update
     * - check that the new tokensForRewards is enough to
     *      maintain the already staked tokens (if any)
     *
     * @param tokensForRewards the new amount of tokens for rewards
     */
    function updateStakingConfig(
        uint256 tokensForRewards
    ) external;

    //////////////////////////////////
    // getter functions
    //////////////////////////////////


    function getStakingConfig(
    ) external view returns (StakingConfig memory);

    /**
     *
     * @return activeUsersCount the number of active users in the config
     * @return totalStaked the total amount of tokens staked in the config
     * @return totalClaimed the total amount of claimable tokens in the config.
     */
    function getConfigUsageData(
    )
        external
        view
        returns (
            uint256 activeUsersCount,
            uint256 totalStaked,
            uint256 totalClaimed
        );

    /**
     * returns the total amount of staked tokens in a config
     */
    function getConfigStakedAmount() external view returns (uint256);

    /**
     * returns the total amount of staked tokens for an specific
     *  user in a config
     * @param user the address of the user.
     */
    function getConfigUserStakedAmount(
        address user
    ) external view returns (uint256);

    /**
     * return the total amount of staked tokens in the contract,
     * for all the configurations.
     */
    function getTotalLockedStakedAmount() external view returns (uint256);

    /**
     * returns the total amount of locked reward tokens in the contract,
     * based on the active configurations.
     *
     * This functions takes into consideration a time-based live-update
     * of the locked amouns, producing two major cases:
     *
     * * when the config is in state [PreOpened, Opened]
     *      - the locked rewards is the configured variable TokensForReward
     * * when the config is in state [Locked, Completed]
     *      - the locked rewards is the computation of rewards
     *          based on the amount of staked tokens
     *
     * with this, each time a config change states based on time-changes
     * the computation will automatically updates on the next function call
     *
     * Also, when a config change states to Locked or Completed, each time a
     * user claims rewards, this computation will update.
     */
    function getTotalLockedRewards() external view returns (uint256);

    /**
     * returns the config current state, which can be:
     * * notSet: when the config does not exists:
     *      - not working functions: stake(), claim()
     * * PreOpened: when the config was recenlty set and has not open yet.
     *      - not working functions: claim(), stake()
     * * Opened: when the config started to receive deposits.
     *      - not working functions: claim()
     *      - working functions: stake()
     * * Locked: when the config stopped receiving deposits
     *      and is in stake-mode.
     *      - not working functions: stake(), claim()
     * * Completed: when the stake-mode is completed and rewards can
     *      be claimed.
     *      - not working functions: stake()
     *      - working functions: claim()
     *
     */
    function getConfigState() external view returns (ConfigState);

    /**
     * returns True if the config is notSet
     */
    function isNotSet() external view returns (bool);

    /**
     * returns True if the config is PreOpened.
     *
     * WARNING: this function does not take into consideration
     *          if the config is inactive, it only considers
     *          the stated based on timestamp and config values.
     */
    function isPreOpened() external view returns (bool);

    /**
     * returns True if the config is Opened
     *
     * WARNING: this function does not take into consideration
     *          if the config is inactive, it only considers
     *          the stated based on timestamp and config values.
     */
    function isOpened() external view returns (bool);

    /**
     * returns True if the config is Locked
     *
     * WARNING: this function does not take into consideration
     *          if the config is  inactive, it only considers
     *          the stated based on timestamp and config values.
     */
    function isLocked() external view returns (bool);

    /**
     * returns True if the config is Completed
     *
     * WARNING: this function does not take into consideration
     *          if the config is  inactive, it only considers
     *          the stated based on timestamp and config values.
     */
    function isCompleted() external view returns (bool);

    /**
     * estimate the rewards that a configuration would give
     * if we deposit a certain amount of stake tokens.
     *
     *
     * @param stakedAmount the staked amount to use in the estimation.
     */
    function estimateConfigRewards(
        uint256 stakedAmount
    ) external view returns (uint256 expectedReward);

    /**
     * estimate the total amount of rewards tokens a config would
     * give based on the currently amount of staked tokens in the config.
     *
     */
    function estimateConfigTotalRewards() external view returns (uint256);

    /**
     * estimates the amount of reward tokens a config would
     * give to a specific user, based on the amount of tokens
     * that user has staked in the config.
     *
     * @param user user address
     */
    function estimateConfigUserRewards(
        address user
    ) external view returns (uint256);


    /**
     * return the total amount of locked tokens from the reward tokens.
     * if the reward tokens and staking tokens are the same, this function
     * will also include the staked amounts from all the configurations.
     */
    function getTotalLockedTokens() external view returns (uint256);

    /**
     * check if the reward token is the same as the stake token.
     */
    function isSameTokenForRewardStake() external view returns (bool);

    /**
     * return the estimated max amount of stake tokens
     * allowed in a configuration, this computation is based in the formula
     *
     * tokensForRewards * 10000000 / (DPROver10kk * maxDays)
     *
     * where the implementation makes sure to handle the respective truncations
     * so the numbers are divisibles.
     *
     */
    function getMaxStakeToken(
    ) external view returns (uint256 maxStake);

}
