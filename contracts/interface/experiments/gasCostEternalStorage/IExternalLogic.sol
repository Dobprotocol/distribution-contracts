// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;


interface IExternalLogic {

    function externalSetUint256(string memory _key, uint256 _value) external;
    function externalGetUint256(string memory _key) external view returns(uint256);
    function externalDeleteUint256(string memory _key) external;
    function externalAddUint256(string memory _key, uint256 _add) external;
    function externalSubUint256(string memory _key, uint256 _sub) external;


    function externalSetString(string memory _key, string memory _value) external;
    function externalGetString(string memory _key) external view returns(string memory);
    function externalDeleteString(string memory _key) external;
    function externalAppendString(string memory _key, string memory _other) external;
}