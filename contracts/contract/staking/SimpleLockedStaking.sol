// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract SimpleLockedStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for ERC20;

    // struct used to facilitate handling of staking configuration
    struct StakingConfig {
        uint256 rewardRate;
        uint256 lockDays;
        uint256 depositDays;
        uint256 startDate;
    }

    // enumeration used to facilitate handling of states
    enum ConfigState {
        Opened,
        Locked,
        Completed,
        NotSet
    }

    // erc20 tokens
    ERC20 private immutable _stakeToken;
    ERC20 private immutable _rewardToken;

    // usage variables
    uint256 _activeUsersCounter;
    uint256 _totalStaked;
    uint256 _claimedRewards;
    mapping(address => uint256) _stakedPerUser;

    // config
    StakingConfig private C;
    uint256 private constant REWARD_FACTOR = 10000;
    uint256 private constant DAY_TO_SECONDS = 86400;

    //////////////////////////////////
    // events
    //////////////////////////////////
    event ConfigSet(
        uint256 rewardRateOver10k,
        uint256 lockPeriodDuration,
        uint256 depositPeriodDuration,
        uint256 startDate
    );
    event StakeTokens(address user, uint256 amount);
    event ClaimTokens(address user, uint256 amountStake, uint256 amountReward);
    event WithdrawRemains(uint256 amount);

    //////////////////////////////////
    // modifiers
    //////////////////////////////////

    modifier isCompleted() {
        require(
            getState() == ConfigState.Completed,
            "Config state must be Completed"
        );
        _;
    }

    modifier isOpened() {
        require(
            getState() == ConfigState.Opened,
            "Config state must be Opened"
        );
        _;
    }

    modifier isNotSet() {
        require(
            getState() == ConfigState.NotSet,
            "Config state must be NotSet"
        );
        _;
    }

    constructor(ERC20 stakingToken, ERC20 rewardsToken) {
        require(
            address(stakingToken) != address(rewardsToken),
            "stake and reward tokens must be different"
        );
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
     * Stake the specified amount and link it to the msg.user
     * This function can only be used when the stake is in state Opened
     *
     * @param _amount the amount to stake
     */
    function stake(uint256 _amount) external nonReentrant isOpened {
        uint256 maxStake = estimateStake(getRewardTokenBalance());
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

    /**
     * Claim the staked and reward tokens for the msg.user
     * This function can only be used when the stake is in state Completed
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
        _safeTransfer(_stakeToken, msg.sender, stakedAmount);
        _safeTransfer(_rewardToken, msg.sender, expectedReward);

        // make the variables updates
        _stakedPerUser[msg.sender] = 0;
        _totalStaked -= stakedAmount;
        _claimedRewards += expectedReward;
        _activeUsersCounter--;
        emit ClaimTokens(msg.sender, stakedAmount, expectedReward);
    }

    /**
     * withdraw any non-locked reward token
     *
     * The withdrawal can only be executed when the stake is on state Completed.
     */
    function withdrawRemains() external onlyOwner nonReentrant isCompleted {
        uint256 withdrawTokens = getRewardTokenBalance() -
            getTotalLockedRewards();
        require(withdrawTokens > 0, "no tokens available to withdraw");
        _safeTransfer(_rewardToken, msg.sender, withdrawTokens);
        emit WithdrawRemains(withdrawTokens);
    }

    //////////////////////////////////
    // config functions
    //////////////////////////////////

    /**
     * set the staking config.
     * This function can only be called once, since after the configuration is set, the state
     * will no longer be NotSet.
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
     * returns the configuration parameters used for the staking.
     */
    function getConfig() external view returns (StakingConfig memory) {
        return C;
    }

    //////////////////////////////////
    // getter functions
    //////////////////////////////////

    /**
     * returns the current configuration usage data
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
     * @param user gets the total staked amount for this user
     */
    function getUserStakedAmount(address user) public view returns (uint256) {
        return _stakedPerUser[user];
    }

    /**
     * returns the total locked reward tokens given the configuration of stake used.
     * The locked amount vary depending on which state the config currently is.
     *
     * If the state is Locked or Completed, the locked reward tokens will be the estimated
     * reward for the currently total staked tokens.
     *
     * If the config is in any other state, then the whole balance is locked.
     */
    function getTotalLockedRewards() public view returns (uint256) {
        ConfigState state = getState();
        if (state == ConfigState.Locked || state == ConfigState.Completed) {
            return estimateRewards(_totalStaked);
        }
        return getRewardTokenBalance();
    }

    /**
     * gets the staking state based on the block timestamp and the
     * given configuration.
     */
    function getState() public view returns (ConfigState) {
        uint256 ts_ = block.timestamp;
        uint256 startLock = C.startDate + C.depositDays;
        if (C.startDate == 0) return ConfigState.NotSet;
        if (C.startDate <= ts_ && ts_ < startLock) return ConfigState.Opened;
        else if (startLock <= ts_ && ts_ < startLock + C.lockDays)
            return ConfigState.Locked;
        else return ConfigState.Completed;
    }

    /**
     * estimate the rewards for the specified user
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
     * estimates the reward tokens that will be obtained for
     * the given input stake amount
     *
     * actual formula:
     *      rewardsToBe = rewardRate * amount / RE_FACTOR
     *
     * @param stakeAmount the staked amount to use in the estimation
     *
     */
    function estimateRewards(
        uint256 stakeAmount
    ) public view returns (uint256 expectedReward) {
        uint256 mul1 = C.rewardRate * stakeAmount;
        if (mul1 - (mul1 % REWARD_FACTOR) > 0) {
            return (mul1 - (mul1 % REWARD_FACTOR)) / REWARD_FACTOR;
        } else {
            return 0;
        }
    }

    /**
     * estimates the stake tokens required to obtain the input
     * reward amount
     *
     * actual formula:
     *      maxStake = rewardBalance * RE_FACTOR / rewardRate
     *
     * @param rewardAmount the reward amount to use in the estimation
     */
    function estimateStake(
        uint256 rewardAmount
    ) public view returns (uint256 maxStake) {
        uint256 mul1 = rewardAmount * REWARD_FACTOR;
        if (mul1 - (mul1 % C.rewardRate) > 0) {
            return (mul1 - (mul1 % C.rewardRate)) / REWARD_FACTOR;
        } else {
            return 0;
        }
    }
}
