// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

/**
 * @title ProxyInterface
 * @author Francisco Muñoz
 * @notice Interface for the simple proxy
 */
interface LogicProxyInterface {

    function initLogic(address _logic) external;
    function initLogicAndCall(address _logic, bytes memory _data) external;
    function getLogicAddress() external view returns(address);
    function isOwner(address _user) external view returns(bool);
    function transferOwner(address _newOwner) external;
}