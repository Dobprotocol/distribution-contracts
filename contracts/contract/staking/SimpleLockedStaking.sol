// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract SimpleLockedStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for ERC20;

    /**
     * @dev Struct to define the staking configuration parameters.
     * @param rewardRate Annualized reward rate (percentage, multiplied by 10000 for precision).
     * @param lockDays Duration (in days) for which the tokens will be locked.
     * @param depositDays Duration (in days) during which users can deposit tokens.
     * @param startDate Timestamp when the staking period starts.
     */
    struct StakingConfig {
        uint256 rewardRate;
        uint256 lockDays;
        uint256 depositDays;
        uint256 startDate;
    }

    /**
     * @dev Enum to define the different states of the staking configuration.
     * - NotSet: Configuration has not been initialized.
     * - Opened: Staking is open for deposits.
     * - Locked: Staking is in the locking phase (deposits closed, tokens locked).
     * - Completed: Staking period is completed (users can claim their rewards).
     */
    enum ConfigState {
        Opened,
        Locked,
        Completed,
        NotSet
    }

    // State variables
    ERC20 private immutable _stakeToken; // ERC20 token used for staking
    ERC20 private immutable _rewardToken; // ERC20 token used for rewards
    uint256 private _activeUsersCounter; // Number of active users with staked tokens
    uint256 private _totalStaked; // Total staked tokens
    uint256 private _claimedRewards; // Total claimed rewards
    mapping(address => uint256) private _stakedPerUser; // Mapping of user addresses to staked amounts

    // Staking configuration
    StakingConfig private C;
    uint256 private constant REWARD_FACTOR = 10000; // Factor for reward rate precision
    uint256 private constant DAY_TO_SECONDS = 86400; // Number of seconds in a day

    //////////////////////////////////
    // events
    //////////////////////////////////

    /**
     * @dev Emitted when the staking configuration is set.
     * @param rewardRateOver10k Reward rate (percentage, multiplied by 10000).
     * @param lockPeriodDuration Duration of the lock period (in days).
     * @param depositPeriodDuration Duration of the deposit period (in days).
     * @param startDate Start date of the staking period (timestamp).
     */
    event ConfigSet(
        uint256 rewardRateOver10k,
        uint256 lockPeriodDuration,
        uint256 depositPeriodDuration,
        uint256 startDate
    );

    /**
     * @dev Emitted when a user stakes tokens.
     * @param user Address of the user who staked tokens.
     * @param amount Amount of tokens staked.
     */
    event StakeTokens(address user, uint256 amount);

    /**
     * @dev Emitted when a user claims their staked tokens and rewards.
     * @param user Address of the user claiming tokens.
     * @param amountStake Amount of staked tokens claimed.
     * @param amountReward Amount of reward tokens claimed.
     */
    event ClaimTokens(address user, uint256 amountStake, uint256 amountReward);

    /**
     * @dev Emitted when the contract owner withdraws remaining reward tokens.
     * @param amount Amount of reward tokens withdrawn.
     */
    event WithdrawRemains(uint256 amount);

    //////////////////////////////////
    // modifiers
    //////////////////////////////////

    /**
     * @dev Ensures the staking configuration is in the "Completed" state.
     */
    modifier isCompleted() {
        require(
            getState() == ConfigState.Completed,
            "Config state must be Completed"
        );
        _;
    }

    /**
     * @dev Ensures the staking configuration is in the "Opened" state.
     */
    modifier isOpened() {
        require(
            getState() == ConfigState.Opened,
            "Config state must be Opened"
        );
        _;
    }

    /**
     * @dev Ensures the staking configuration is in the "NotSet" state.
     */
    modifier isNotSet() {
        require(
            getState() == ConfigState.NotSet,
            "Config state must be NotSet"
        );
        _;
    }

    //////////////////////////////////
    // Constructor
    //////////////////////////////////

    /**
     * @dev Initializes the contract with staking and reward tokens.
     * @param stakingToken ERC20 token used for staking.
     * @param rewardsToken ERC20 token used for rewards.
     */
    constructor(ERC20 stakingToken, ERC20 rewardsToken) {
        require(
            address(stakingToken) != address(rewardsToken),
            "stake and reward tokens must be different"
        );
        _stakeToken = stakingToken;
        _rewardToken = rewardsToken;
    }

    //////////////////////////////////
    // deposit/withdraw functions
    //////////////////////////////////

    /**
     * @notice Allows a user to stake tokens during the deposit period.
     * @dev Ensures the staking configuration is in the "Opened" state.
     * @param _amount Amount of tokens to stake.
     */
    function stake(uint256 _amount) external nonReentrant isOpened {
        uint256 maxStake = estimateStake(getRewardTokenBalance());
        require(
            _totalStaked + _amount <= maxStake,
            "cannot stake more than the allowed amount"
        );
        _stakeToken.safeTransferFrom(msg.sender, address(this), _amount);

        // update variables
        if (_stakedPerUser[msg.sender] == 0) {
            _activeUsersCounter++;
        }
        _stakedPerUser[msg.sender] += _amount;
        _totalStaked += _amount;
        emit StakeTokens(msg.sender, _amount);
    }

    /**
     * @notice Allows a user to claim their staked tokens and rewards after the lock period.
     * @dev Ensures the staking configuration is in the "Completed" state.
     */
    function claim() external nonReentrant isCompleted {
        uint256 stakedAmount = getUserStakedAmount(msg.sender);
        require(stakedAmount > 0, "User does not have staked tokens");
        uint256 expectedReward = estimateRewards(stakedAmount);
        require(
            getRewardTokenBalance() > expectedReward,
            "Not enough reward tokens"
        );

        // transfer the tokens
        _stakeToken.safeTransfer(msg.sender, stakedAmount);
        _rewardToken.safeTransfer(msg.sender, expectedReward);

        // make the variables updates
        _stakedPerUser[msg.sender] = 0;
        _totalStaked -= stakedAmount;
        _claimedRewards += expectedReward;
        _activeUsersCounter--;
        emit ClaimTokens(msg.sender, stakedAmount, expectedReward);
    }

    /**
     * @notice withdraw any non-locked reward token
     * @dev Ensures the staking configuration is in the "Completed" state.
     */
    function withdrawRemains() external onlyOwner nonReentrant isCompleted {
        require(getRewardTokenBalance() > getTotalLockedRewards(), "no tokens available to withdraw");
        uint256 withdrawTokens = getRewardTokenBalance() -
            getTotalLockedRewards();
        _rewardToken.safeTransfer(msg.sender, withdrawTokens);
        emit WithdrawRemains(withdrawTokens);
    }

    //////////////////////////////////
    // config functions
    //////////////////////////////////

    /**
     * @notice set the staking config.
     * @dev This function can only be called once, since after the configuration is set, 
     * the state will no longer be NotSet.
     *
     * @param config the configuration to set
     */
    function setConfig(
        StakingConfig memory config
    ) external onlyOwner isNotSet {
        require(
            config.lockDays >= 7,
            "lockPeriodDuration must be at least 1 week"
        );
        require(
            config.depositDays >= 1,
            "depositPeriodDuration must be at least 1 day"
        );
        require(
            config.startDate >= block.timestamp,
            "StartDate must be at least the same as the current block timestamp"
        );
        // if everything checks, create the config
        C = config;
        emit ConfigSet(
            config.rewardRate,
            config.lockDays,
            config.depositDays,
            config.startDate
        );
    }

    /**
     * @notice returns the configuration parameters used for the staking.
     */
    function getConfig() external view returns (StakingConfig memory) {
        return C;
    }

    //////////////////////////////////
    // getter functions
    //////////////////////////////////

    /**
     * @notice gets the current configuration usage data
     *
     * @return activeUsersCount the number distinct unique address that have staked tokens
     * @return totalStaked the total amount of staked tokens
     * @return totalClaimed the total amount of claimed reward tokens
     * @return rewardBalance the current smart-contract balance of the reward tokens
     */
    function getConfigUsageData()
        external
        view
        returns (
            uint256 activeUsersCount,
            uint256 totalStaked,
            uint256 totalClaimed,
            uint256 rewardBalance
        )
    {
        activeUsersCount = _activeUsersCounter;
        totalStaked = _totalStaked;
        totalClaimed = _claimedRewards;
        rewardBalance = getRewardTokenBalance();
    }

    /**
     * @notice gets the total staked tokens for the given user
     * @param user the user to get its total staked tokens
     */
    function getUserStakedAmount(address user) public view returns (uint256) {
        return _stakedPerUser[user];
    }

    /**
     * @notice returns the total locked reward tokens given the configuration of stake used.
     * The locked amount vary depending on which state the config currently is.
     *
     * @dev If the state is Locked or Completed, the locked reward tokens will be the estimated
     * reward for the currently total staked tokens. If the config is in any other state, 
     * then the whole balance is locked.
     */
    function getTotalLockedRewards() public view returns (uint256) {
        if (
            getState() == ConfigState.Locked ||
            getState() == ConfigState.Completed
        ) {
            return estimateRewards(_totalStaked);
        }
        return getRewardTokenBalance();
    }

    /**
     * @notice gets the staking state based on the block timestamp and the
     * given configuration.
     */
    function getState() public view returns (ConfigState) {
        if (C.startDate == 0) return ConfigState.NotSet;

        uint256 ts_ = block.timestamp;
        uint256 startLock = C.startDate + C.depositDays;

        if (C.startDate <= ts_ && ts_ < startLock) return ConfigState.Opened;
        if (startLock <= ts_ && ts_ < startLock + C.lockDays)
            return ConfigState.Locked;

        return ConfigState.Completed;
    }

    /**
     * @notice estimate the rewards for the specified user
     * @param user the user to estimate rewards for
     */
    function estimateConfigUserRewards(
        address user
    ) external view returns (uint256) {
        return estimateRewards(_stakedPerUser[user]);
    }

    /**
     * get the total reward token balance in the contract
     */
    function getRewardTokenBalance() public view returns (uint256) {
        return _rewardToken.balanceOf(address(this));
    }

    /**
     * @dev Estimates the rewards based on the stake amount. The formula used is:
     *      reward = (stakeAmount * rewardRate) / REWARD_FACTOR.
     * @param stakeAmount The amount of staked tokens to estimate the reward for.
     * @return expectedReward The estimated reward tokens for the given stake.
     */
    function estimateRewards(
        uint256 stakeAmount
    ) public view returns (uint256 expectedReward) {
        expectedReward = (stakeAmount * C.rewardRate) / REWARD_FACTOR;
    }

    /**
     * @dev Estimates the max stake based on the reward amount. The formula used is:
     *      stake = (rewardAmount * REWARD_FACTOR) / rewardRate.
     * @param rewardAmount The amount of reward tokens to estimate the stake for.
     * @return maxStake The estimated  max stake tokens for the given reward.
     */
    function estimateStake(
        uint256 rewardAmount
    ) public view returns (uint256 maxStake) {
        maxStake = (rewardAmount * REWARD_FACTOR) / C.rewardRate;
    }
}
