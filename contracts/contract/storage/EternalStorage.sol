// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "./EternalStorageRoles.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * 
 * @title EthernalStorage
 * @author Francisco Muñoz
 * @notice implementation of EternalStorage as it was used in RocketPool protocol
 *          (https://github.com/rocket-pool/rocketpool)
 */
contract EternalStorage is EternalStorageRoles {
    // Libraries

    // Storage maps
    mapping(bytes32 => string) private stringStorage;
    mapping(bytes32 => bytes) private bytesStorage;
    mapping(bytes32 => uint256) private uintStorage;
    mapping(bytes32 => int256) private intStorage;
    mapping(bytes32 => address) private addressStorage;
    mapping(bytes32 => bool) private booleanStorage;
    mapping(bytes32 => bytes32) private bytes32Storage;


    constructor() EternalStorageRoles(){
    }


    function getAddress(bytes32 _key) external view override onlyRole(USER_ROLE) returns (address) {
        return addressStorage[_encode(msg.sender, _key)];
    }

    function getUint256(bytes32 _key) external view override onlyRole(USER_ROLE) returns (uint256) {
        return uintStorage[_encode(msg.sender, _key)];
    }

    function getString(
        bytes32 _key
    ) external view override onlyRole(USER_ROLE) returns (string memory) {
        return stringStorage[_encode(msg.sender, _key)];
    }

    function getBytes(
        bytes32 _key
    ) external view override onlyRole(USER_ROLE) returns (bytes memory) {
        return bytesStorage[_encode(msg.sender, _key)];
    }

    function getBool(bytes32 _key) external view override onlyRole(USER_ROLE) returns (bool) {
        return booleanStorage[_encode(msg.sender, _key)];
    }

    function getInt(bytes32 _key) external view override onlyRole(USER_ROLE) returns (int) {
        return intStorage[_encode(msg.sender, _key)];
    }

    function getBytes32(bytes32 _key) external view override onlyRole(USER_ROLE) returns (bytes32) {
        return bytes32Storage[_encode(msg.sender, _key)];
    }

    /** SET FUNCTIONS */
    function setAddress(
        bytes32 _key,
        address _value
    ) external override onlyRole(USER_ROLE) {
        addressStorage[_encode(msg.sender, _key)] = _value;
    }

    function setUint256(
        bytes32 _key,
        uint256 _value
    ) external override onlyRole(USER_ROLE) {
        uintStorage[_encode(msg.sender, _key)] = _value;
    }

    function setString(
        bytes32 _key,
        string calldata _value
    ) external override onlyRole(USER_ROLE) {
        stringStorage[_encode(msg.sender, _key)] = _value;
    }

    function setBytes(
        bytes32 _key,
        bytes calldata _value
    ) external override onlyRole(USER_ROLE) {
        bytesStorage[_encode(msg.sender, _key)] = _value;
    }

    function setBool(
        bytes32 _key,
        bool _value
    ) external override onlyRole(USER_ROLE) {
        booleanStorage[_encode(msg.sender, _key)] = _value;
    }

    function setInt(bytes32 _key, int _value) external override onlyRole(USER_ROLE) {
        intStorage[_encode(msg.sender, _key)] = _value;
    }

    function setBytes32(
        bytes32 _key,
        bytes32 _value
    ) external override onlyRole(USER_ROLE) {
        bytes32Storage[_encode(msg.sender, _key)] = _value;
    }


    /** DELETE FUNCTIONS  */
    function deleteAddress(bytes32 _key) public override onlyRole(USER_ROLE) {
        delete addressStorage[_encode(msg.sender, _key)];
    }

    function deleteUint256(bytes32 _key) public override onlyRole(USER_ROLE) {
        delete uintStorage[_encode(msg.sender, _key)];
    }

    function deleteString(bytes32 _key) public override onlyRole(USER_ROLE) {
        delete stringStorage[_encode(msg.sender, _key)];
    }

    function deleteBytes(bytes32 _key) public override onlyRole(USER_ROLE) {
        delete bytesStorage[_encode(msg.sender, _key)];
    }

    function deleteBool(bytes32 _key) public override onlyRole(USER_ROLE) {
        delete booleanStorage[_encode(msg.sender, _key)];
    }

    function deleteInt(bytes32 _key) public override onlyRole(USER_ROLE) {
        delete intStorage[_encode(msg.sender, _key)];
    }

    function deleteBytes32(bytes32 _key) public override onlyRole(USER_ROLE) {
        delete bytes32Storage[_encode(msg.sender, _key)];
    }

    function _encode(
        address _sender,
        bytes32 _key
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_sender, _key));
    }
}