// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

interface TokenSaleMarketInterface {
    function setSaleProperties(address tokenAddress, uint256 salePrice, uint256 minDivision) external;
    function setInitialSaleProperties(address poolAddress, uint256 salePrice, uint256 minDivision) external;
    function getSaleProperties(address tokenAddress) external view returns(
        uint256 salePrice,
        uint256 minDivision,
        bool applyCommission,
        bool lockStatus
    );
    function buyToken(uint256 nTokenToBuy, address seller, address tokenAddress) payable external;
    function lockSale(address tokenAddress) external;
    function unlockSale(address tokenAddress) external;
}