// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;


interface ILocalLogic {

    function localSetUint256(string memory _key, uint256 _value) external;
    function localGetUint256(string memory _key) external view returns(uint256);
    function localDeleteUint256(string memory _key) external;
    function localAddUint256(string memory _key, uint256 _add) external;
    function localSubUint256(string memory _key, uint256 _sub) external;


    function localSetString(string memory _key, string memory _value) external;
    function localGetString(string memory _key) external view returns(string memory);
    function localDeleteString(string memory _key) external;
    function localAppendString(string memory _key, string memory _other) external;
}