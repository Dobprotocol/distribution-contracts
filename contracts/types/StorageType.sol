// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

// main enumerator used for events addRecord and subRecord,
// DO NOT REMOVE TYPES FROM THIS ENUM, JUST ADD MORE IF NEEDED.
enum StorageType {
    uint256Type,
    addressType,
    stringType,
    bytesType,
    boolType,
    int256Type,
    bytes32Type
}