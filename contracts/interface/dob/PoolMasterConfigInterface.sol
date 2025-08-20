// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

interface PoolMasterConfigInterface{
    // getters
    function getSharesLimit() external view returns (uint256);
    function getOperationalAddress() external view returns (address);
    function getRegressionParams() external view returns (uint256 coef, uint256 intercept, uint256 gasPrice);
    function getCommission() external view returns (uint256);
    // setters
    function setSharesLimit(uint256 _sharesLimit) external;
    function setOperationalAddress(address _newOperational) external;
    function setRegressionParams(uint256 _newCoef, uint256 _newIntercept, uint256 _newGasPrice) external;
    function setCommission(uint256 _commission) external;

    // deploys (equivalents to createProxy)
    function expectedTotalGas(
        uint256 nUsers, uint256 nDistributions
    ) external view returns(uint256);

    // logic-proxy
    function addLogicVersion(address _logic, uint256 _version, string memory _logicName) external;
    function addLogic(address _logic, string memory _logicName) external;
    function getLogicVersion(uint256 _version) external view returns(address _logic, string memory _name);
    function getLatestVersion() external view returns(address _logic, string memory _name);
    function getLatestVersionNumber() external view returns(uint256);
    // function updateProxyLogic(string memory proxyName, uint256 _version) external;
}