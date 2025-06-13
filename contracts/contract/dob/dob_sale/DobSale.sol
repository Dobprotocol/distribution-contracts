// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// OpenZeppelin imports
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title SimpleTokenSale
 * @dev Sells a token at a fixed price in ETH (wei).
 *      If someone calls `buyTokens(1)`, they get exactly 1 "full token,"
 *      meaning 1 * 10^decimals() on-chain.
 */
contract DobSale is ReentrancyGuard, Ownable {
    using SafeERC20 for ERC20;
    ERC20 public token;  // The token being sold
    uint8 public tokenDecimals;   // Stored decimals from the token
    uint256 public price;         // Wei per 1 "full token"
    uint256 public totalSales;  // total amount of tokens sales
    uint256 public totalFunds; // total amount of funds earned

    // add commission percent and address
    uint256 public commissionPercent;
    address public commissionAddress;


    // event to track sales
    event BuyToken(
        address buyer,
        uint256 amount,
        uint256 value
    );

    // event to track funds earned withdraws
    event WithdrawFunds(
        uint256 funds

    );


    /**
     * @dev Constructor
     * @param _token Address of the ERC20 token to sell (must implement decimals()).
     * @param _price Wei per 1 full token. (e.g., 1e18 = 1 ETH per token, 1e16 = 0.01 ETH, etc.)
     */
    constructor(ERC20 _token, uint256 _price, uint256 _commissionPercent, address _commissionAddress) {
        require(address(_token) != address(0), "Token address cannot be zero");
        require(_price > 0, "Price must be > 0");
        require(_token.allowance(owner(), address(this)) > 0, "No allowance available"); // check existing allowance

        token = _token;
        price = _price;
        commissionPercent = _commissionPercent;
        commissionAddress = _commissionAddress;

        // Read decimals from the token itself
        tokenDecimals = _token.decimals();
    }

    /**
     * @dev Buy tokens by specifying how many full tokens (not smallest units) you want.
     *      e.g., if you call `buyToken(1)`, you get exactly 1 * 10^decimals() tokens on-chain.
     * @param _fullTokens The number of whole tokens to buy (1 = 1 full token).
     */
    function buyToken(uint256 _fullTokens) external payable nonReentrant {
        require(_fullTokens > 0, "Must buy at least 1 token");

        // 1 full token (as humans see it) = 10^tokenDecimals on-chain
        uint256 tokenAmount = _fullTokens * (10 ** tokenDecimals);

        // Calculate total cost in wei: price * number of full tokens
        // (Price is defined as wei per 1 full token.)
        uint256 cost = price * _fullTokens;

        require(msg.value >= cost, "Not enough ETH sent");

        // try to transfer the tokens
        // this will revert if not enough allowance is available
        token.transferFrom(address(this), msg.sender, tokenAmount);

        // Refund any excess Ether if the user sent more than required
        if (msg.value > cost) {
            payable(msg.sender).transfer(msg.value - cost);
        }

        // calculate the commission and the profit for the owner
        uint256 commission = cost * commissionPercent / 100;
        uint256 profit = cost - commission;
        // send the commission to the commission address
        payable(commissionAddress).transfer(commission);
        // send the profit to the owner
        payable(owner()).transfer(profit);
        
        totalSales += tokenAmount;
        totalFunds += cost;

        emit BuyToken(
            msg.sender,
            tokenAmount,
            cost
        );
    }

    // /**
    //  * @dev Withdraw all ETH from this contract (collected from sales).
    //  */
    // function withdrawFunds() onlyOwner external {
    //     uint256 balance = address(this).balance;
    //     require(balance > 0, "No ETH to withdraw");
    //     payable(msg.sender).transfer(balance);
    //     emit WithdrawFunds(balance);
    // }

}