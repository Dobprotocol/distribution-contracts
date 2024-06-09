// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

/**
 * @title StorageInterface
 * @author Francisco Muñoz
 * @notice Interface used to determine the Eternal Stroga structure 
 *          as it is used in RocketPool (https://github.com/rocket-pool/rocketpool)
 */
interface StorageInterface {

    // Getters
    function getAddress(bytes32 _key) external view returns (address);
    function getUint256(bytes32 _key) external view returns (uint256);
    function getString(bytes32 _key) external view returns (string memory);
    function getBytes(bytes32 _key) external view returns (bytes memory);
    function getBool(bytes32 _key) external view returns (bool);
    function getInt(bytes32 _key) external view returns (int);
    function getBytes32(bytes32 _key) external view returns (bytes32);

    // Setters
    function setAddress(bytes32 _key, address _value) external;
    function setUint256(bytes32 _key, uint256 _value) external;
    function setString(bytes32 _key, string calldata _value) external;
    function setBytes(bytes32 _key, bytes calldata _value) external;
    function setBool(bytes32 _key, bool _value) external;
    function setInt(bytes32 _key, int _value) external;
    function setBytes32(bytes32 _key, bytes32 _value) external;

    // Deleters
    function deleteAddress(bytes32 _key) external;
    function deleteUint256(bytes32 _key) external;
    function deleteString(bytes32 _key) external;
    function deleteBytes(bytes32 _key) external;
    function deleteBool(bytes32 _key) external;
    function deleteInt(bytes32 _key) external;
    function deleteBytes32(bytes32 _key) external;

    // Guardian
    function getGuardian() external view returns(address);
    function setGuardian(address _newAddress) external;

    // grant roles
    function grantAdminRole(address account) external;
    function grantUserRole(address account) external;

    // check roles
    function isAdmin(address account) external view returns(bool);
    function isUser(address account) external view returns(bool);

    // revoke roles
    function revokeAdminRole(address account) external;
    function revokeUserRole(address account) external;
}