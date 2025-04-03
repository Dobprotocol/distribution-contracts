// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

interface ParticipationTokenCheckInterface {
    /**
     * @dev Returns the decimals places of the token.
     */
    function decimals() external view returns (uint8);

    /**
     * @dev Returns the amount of tokens in existence.
     */
    function totalSupply() external view returns (uint256);
    
}