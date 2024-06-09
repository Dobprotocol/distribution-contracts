// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

// main enumerator used for events addRecord and subRecord,
// DO NOT REMOVE TYPES FROM THIS ENUM, JUST ADD MORE IF NEEDED.
enum DataType {
    CurrentAmount,  //dtype:0 ethPool
    CurrentDistAmount, //dtype:1 ethPool NOT USED ANYMORE
    PrePay, //dtype:2 ethPool, tokenPool
    GasCost,  //dtype:3 ethPool, tokenPool
    Distribute, //dtype:4 tokenPool
    UserDistribute //dtype:5 ethPool, tokenPool
}