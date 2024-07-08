// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "../../types/StakingConfig.sol";

interface LockedStakingInterface {

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

    // set a config to dropped
    // a dropped config cannot give rewards
    // nor allow deposits, it will only allow claims
    // of staked amounts
    // CAN ONLY BE EXECUTED BY OWNER
    function dropStakingConfig(
        bytes32 _key
    ) external;

    function flushOldConfigs() external;

    function updateStakingConfig(
        bytes32 _key, uint256 tokensForRewards
    ) external;


    function getStakingConfig(bytes32 _key) external view returns (
        StakingConfig memory
    );

    function getConfigKey(StakingConfig memory config) external view returns (bytes32);

    function getTotalLockedStakedAmount() external view returns (uint256);

    function getTotalLockedRewards() external view returns (uint256);

    function getConfigState(bytes32 key) external view returns (ConfigState);

    function estimateRemainingRewards(
        bytes32 key
    ) external view returns (uint256);

    function configExists(bytes32 key) external view returns (bool);

    function getTotalLockedTokens() external view returns (uint256);
}
