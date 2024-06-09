// SPDX-License-Identifier: BSL-1.0
pragma solidity ^0.8.2;

import "../../dob/DistributionPool.sol";

contract NoLimitDistributionPool is DistributionPool {

    constructor (address _storage) DistributionPool(_storage) {}

    function canDistribute(address _token) public view override virtual returns(bool) {
        uint256 currT = block.timestamp;
        // ***********************
        // use this line for special test
        bool conditionLast = _S.getUint256(
            _ptKey(KeyPrefix.prevDistributionDate, _token)
        ) +
            0 hours <=
            currT;
        // ***********************
        // use this line for production
        // bool conditionLast = _S.getUint256(
        //     _ptKey(KeyPrefix.prevDistributionDate, _token)
        // ) +
        //     12 hours <=
        //     currT;
        // ***********************
        // console.log("conditionLast", conditionLast);
        // console.log("prevDistributionDate", _S.getUint256(
        //     _ptKey(KeyPrefix.prevDistributionDate, _token)
        // ));
        // console.log("indexTime < currT", _getDistributionDate(
        //             _S.getUint256(_ptKey(KeyPrefix.index, _token)),
        //             _token
        //         ) <=
        //         currT);
        // ***********************
        return (conditionLast &&
            _getDistributionDate(
                _S.getUint256(_ptKey(KeyPrefix.index, _token)),
                _token
            ) <=
            currT);
    }

}