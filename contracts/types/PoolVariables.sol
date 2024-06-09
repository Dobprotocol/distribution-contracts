// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

struct PoolVariables{
    bool isPublic;
    uint256 commission;
    uint256 coef;
    uint256 intercept;
    uint256 nDistributions;
    uint256 index;
    uint256 firstDistributionDate;
    uint256 prevDistributionDate;
    uint256 distributionInterval;
}