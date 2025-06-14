// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./DobSale.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DobSaleFactory is Ownable {
    uint256 public commissionPercent;
    address public commissionAddress;
    // mapping(bytes32 => address) public dobSales;

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

    /**
     * @dev Creates a new DobSale contract.
     * @param _paymentToken the token used to pay for Dob tokens, can be 0x0 to use currency for payments.
     * @param _token the ERC20 token being sold
     * @param _price the price of 1 token in terms of the payment token
     * @return the address of the newly created DobSale contract
     */
    function createDobSale(
        address _paymentToken,
        address _token,
        uint256 _price
    ) public returns (address) {
        DobSale sale = new DobSale(
            _paymentToken,
            _token,
            _price,
            commissionPercent,
            commissionAddress
        );
        sale.transferOwnership(msg.sender);
        // bytes32 sign = getDobSaleSign(msg.sender, _paymentToken, _token, _price);
        // dobSales[sign] = address(sale);
        emit DobSaleCreated(
            msg.sender,
            _token,
            _price,
            commissionPercent,
            commissionAddress
        );
        return address(sale);
    }

    // function getDobSaleSign(address _seller, address _paymentToken, address _token, uint256 _price) public pure returns (bytes32) {
    //     return keccak256(abi.encodePacked(_seller, _paymentToken, _token, _price));
    // }

    // function closeDobSale(address _paymentToken, address _token, uint256 _price) public {
    //     bytes32 _sign = getDobSaleSign(msg.sender, _paymentToken, _token, _price);
    //     require(dobSales[_sign] != address(0), "DobSale does not exist");
    //     DobSale(dobSales[_sign]).lockSale();
    //     dobSales[_sign] = address(0);
    // }
}
