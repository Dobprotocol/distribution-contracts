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
    address public paymentToken;
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
        uint256 value,
        uint256 commission,
        uint256 profit
    );


    /**
     * @dev Constructor
     * @param _paymentToken Address of the payment token, zero for currency (e.g. ETH)
     * @param _token Address of the ERC20 token to sell (must implement decimals()).
     * @param _price Wei per 1 full token. (e.g., 1e18 = 1 ETH per token, 1e16 = 0.01 ETH, etc.)
     * @param _commissionPercent The commission percent (e.g., 5 = 5%)
     * @param _commissionAddress The address to receive the commission
     */
    constructor(address _paymentToken, ERC20 _token, uint256 _price, uint256 _commissionPercent, address _commissionAddress) {
        require(address(_token) != address(0), "Token address cannot be zero");
        require(_price > 0, "Price must be > 0");
        require(_token.allowance(owner(), address(this)) > 0, "No allowance available"); // check existing allowance

        paymentToken = _paymentToken;
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
        // calculate the commission and the profit for the owner
        uint256 commission = cost * commissionPercent / 100;
        uint256 profit = cost - commission;

        // try to transfer the tokens
        // this will revert if not enough allowance is available
        token.transferFrom(address(this), msg.sender, tokenAmount);

        if (paymentToken == address(0)) {
            _processCurrencyPayment(cost, commission, profit);
        } else {
            _processERC20Payment(cost, commission, profit);
        }
        
        totalSales += tokenAmount;
        totalFunds += cost;

        emit BuyToken(
            msg.sender,
            tokenAmount,
            cost,
            commission,
            profit
        );
    }

    function _processCurrencyPayment(uint256 cost, uint256 commission, uint256 profit) internal {
        require(msg.value >= cost, "Not enough ETH sent");

        // send the commission to the commission address
        payable(commissionAddress).transfer(commission);
        // send the profit to the owner
        payable(owner()).transfer(profit);

        // Refund any excess Ether if the user sent more than required
        if (msg.value > cost) {
            payable(msg.sender).transfer(msg.value - cost);
        }
    }

    function _processERC20Payment(uint256 cost, uint256 commission, uint256 profit) internal {
        // if buying with ERC20 token, the buyer must first perform an approve() for the allowance
        ERC20 _paymentToken = ERC20(paymentToken);
        // check enough allowance available for payment tokens from the buyer
        require(_paymentToken.allowance(msg.sender, address(this)) >= cost, "Not enough allowance");

        // send the commission to the commission address
        _paymentToken.transferFrom(msg.sender, commissionAddress, commission);
        // send the profit to the owner
        _paymentToken.transferFrom(msg.sender, owner(), profit);

        // refund any excess if the user allowed to spend more than required
        // TODO: do we really have to refund it???
        if (_paymentToken.allowance(msg.sender, address(this)) > 0) {
            _paymentToken.transferFrom(msg.sender, msg.sender, _paymentToken.allowance(msg.sender, address(this)));
        }
    }

}
