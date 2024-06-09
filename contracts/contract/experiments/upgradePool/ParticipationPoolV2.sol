// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "../../dob/DistributionPool.sol";

contract ParticipationPoolV2 is DistributionPool {

    constructor(address _storage) DistributionPool(_storage){}

    function getOperationalAddress() public view override returns(address){
        return owner();
    }

    function abiEncodeInitialize(
        string memory _poolData,
        address[4] memory _addrs, 
        uint256[8] memory _vars
    ) public pure returns(bytes memory){
        return abi.encodeWithSignature(
            "initialize(string,address[4],uint256[8])", 
            _poolData, _addrs, _vars);
    }
}