pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./DobSale.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DobSaleFactory is Ownable {
    uint256 public commissionPercent;
    address public commissionAddress;

    event DobSaleCreated(
        address indexed owner,
        address indexed token,
        uint256 price,
        uint256 commissionPercent,
        address commissionAddress
    );

    constructor() {
        commissionPercent = 5; // 5%
        commissionAddress = address(0); // to this factory contract
    }

    function setCommissionPercent(uint256 _commissionPercent) public onlyOwner {
        commissionPercent = _commissionPercent;
    }

    function setCommissionAddress(address _commissionAddress) public onlyOwner {
        commissionAddress = _commissionAddress;
    }

    function createDobSale(
        address _token,
        uint256 _price
    ) public returns (address) {
        ERC20 token = ERC20(_token);
        DobSale sale = new DobSale(
            token,
            _price,
            commissionPercent,
            commissionAddress
        );
        emit DobSaleCreated(
            msg.sender,
            _token,
            _price,
            commissionPercent,
            commissionAddress
        );
        return address(sale);
    }
}
