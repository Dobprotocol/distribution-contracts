// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

interface PoolMasterInterface{
    // getters
    function getTreasuryPool() external view returns (address);
    function getPoolMasterConfig() external view returns (address);

    // setters
    function setPoolMasterConfig(address _config) external;

    // deploys (equivalents to createProxy)

    function createRewardPool(
        address[] calldata users, 
        uint256[] calldata shares,
        uint256 goalAmount,
        string calldata poolData
    ) external payable;

    function createPayrollPool(
        address[] calldata users, 
        uint256[] calldata shares,
        uint256[] calldata timeConfig,
        uint256 goalAmount,
        string calldata poolData
    ) external payable;

    function createTreasuryPool(
        address[] calldata users, 
        uint256[] calldata shares,
        uint256[] calldata timeConfig,
        string calldata poolData
    ) external payable;

    function createPoolMasterTreasuryPool(
        address[] calldata users,
        uint256[] calldata shares,
        string calldata poolData
    ) external payable;

    function initialize(
        address _config
    ) external;
}