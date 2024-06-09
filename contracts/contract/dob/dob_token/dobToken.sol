// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
// Importing OpenZeppelin's SafeMath Implementation
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract DobToken is ERC20, Initializable {
    using SafeMath for uint256;

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
    }

    function decimals() public pure override returns(uint8){
        return 18;
    }

    function mint_supply(address owner_, uint256 supply_) initializer public {
        _mint(owner_, supply_);
    }
}
