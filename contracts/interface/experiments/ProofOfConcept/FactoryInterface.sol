// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

/**
 * @title FactoryInterface
 * @author Francisco Muñoz
 * @notice Interface for the simple factory instance
 */
interface FactoryInterface {

    function addLogicVersion(address _logic, string memory _version) external;
    function getLogicVersion(string memory _version) external view returns(address);
    function getLatestVersion() external view returns(address);
    function createProxy(string memory proxyName) external returns(address);
    function updateProxyLogic(string memory proxyName, string memory _version) external;
}