// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "../../types/StakingConfig.sol";
// import "../StorageInterface.sol";

interface LockedStakingInterface {

    // struct StakingConfig{
    //     uint256 id;
    //     uint256 dprOver100000;
    //     uint256 tokensForRewards;
    //     uint256 lockPeriodDuration;
    //     uint256 depositPeriodDuration;
    //     uint256 startDate;
    //     mapping(address => uint256) _stakedPerUser;
    //     uint256 _activeUsersCounter;
    //     uint256 _totalStaked;
    // }

    // deposit tokens to a specific stake config
    function stake(uint256 _configId, uint256 _amount) external;

    // claim staked tokens + rewards from an specific stake config
    function claim(uint256 _configId) external;

    // withdraw from a stake config without gaining rewards, 
    // claims only the staked amount
    function earlyWithdraw(uint256 _configId) external;

    // withdraw the balance that is not locked behind a stake config
    // this function can only be used by the owner address
    function withdrawRemains() external;

    // set a new staking config to the pool
    function setStakingConfig(
        StakingConfig memory config
    ) external returns(bytes32);

    // drop and close a staking config
    // this will execute transfetFrom() calls to return funds
    // to each address asigned to the stake config
    // depending on the date, this could be considered
    // and early withdraw and not give rewards to anyone.
    // CAN ONLY BE EXECUTED BY OWNER
    function dropStakingConfig(
        bytes32 _key
    ) external;

    function updateStakingConfig(
        bytes32 _key, uint256 tokensForRewards
    ) external;


    function getStakingConfig(bytes32 _key) external view returns (
        StakingConfig memory
    );

    function getConfigKey(StakingConfig memory config) external view returns (bytes32);
}
