// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

// Importing OpenZeppelin's SafeMath Implementation
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// relative interface imports
import "../../interface/dob/DistributionPoolInterface.sol";
import "../../interface/dob/TokenSaleMarketInterface.sol";

// relative contract imports
import "../storage/AccessStorageOwnableInitializable.sol";
import "../core/LogicProxiable.sol";
import "../remote/RemoteOwnable.sol";

// import types
import "../../types/KeyPrefix.sol";
import "../../types/PoolType.sol";
import "hardhat/console.sol";

// struct TokenSale {
//     uint256 token_price;
//     uint256 min_division;
// }

contract TokenSaleMarket is
    TokenSaleMarketInterface,
    AccessStorageOwnableInitializable,
    LogicProxiable
{
    using SafeMath for uint256;

    event SaleProperty(
        address seller,
        address token,
        uint256 price,
        uint256 unit,
        bool applyCommission
    );
    event BuyRecord(
        address seller,
        address buyer,
        address token,
        uint256 amount,
        uint256 price,
        uint256 spent,
        uint256 commission
    );
    event FeeUpdate(
        uint256 fee
    );

    event SaleLockStatus(address token, address seller, bool locked);

    constructor(
        address _storage
    ) AccessStorageOwnableInitializable(_storage, "token.sale.market") {}

    function _paaKey(
        KeyPrefix _prefix,
        address _addr1,
        address _addr2
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(_nameSpace, _prefix, _addr1, _addr2));
    }

    function initialize(
        address _owner,
        uint256 _commissionFee
    ) public virtual initializer {
        require(_commissionFee < 10000, "COMMISSION_SHOULD_BE_LOWER_THAN_10000");

        // ownable init
        _transferOwnership(_owner);

        // store the commission fee, which sould be a number between [0, 10000[
        _S.setUint256(
            _pKey(KeyPrefix.tokenSaleMarketCommission),
            _commissionFee
        );
        emit FeeUpdate(_commissionFee);
    }

    function _setSaleProperties(
        address _tokenAddress,
        uint256 _price,
        uint256 _minDivision,
        bool _applycommission
    ) internal virtual {
        // check that the token address is valid and owner as at least _minDivision tokens
        require(
            _balanceValidation(_minDivision, msg.sender, _tokenAddress),
            "SELLER_HAS_NO_BALANCE"
        );

        _S.setUint256(
            _paaKey(KeyPrefix.tsmSalePrice, msg.sender, _tokenAddress),
            _price
        );
        _S.setUint256(
            _paaKey(KeyPrefix.tsmMinDivision, msg.sender, _tokenAddress),
            _minDivision
        );
        _S.setBool(
            _paaKey(KeyPrefix.tsmApplyCommission, msg.sender, _tokenAddress),
            _applycommission
        );
        emit SaleProperty(
            msg.sender,
            _tokenAddress,
            _price,
            _minDivision,
            _applycommission
        );
    }

    /**
     * set a new configuration to sale token
     * @param tokenAddress the token that is being sold
     * @param salePrice the pice of minDivision wei-tokens, in wei units
     * @param minDivision the minimum amount of wei-tokens allowed to buy
     */
    function setSaleProperties(
        address tokenAddress,
        uint256 salePrice,
        uint256 minDivision
    ) external virtual override onlyProxy {
        _setSaleProperties(tokenAddress, salePrice, minDivision, true);
    }

    /**
     * set a new configuration to a initial sale token
     * @param poolAddress the address of the pool from where we are doing this initial sale
     * @param salePrice the pice of minDivision wei-tokens, in wei units
     * @param minDivision the minimum amount of wei-tokens allowed to buy
     */
    function setInitialSaleProperties(
        address poolAddress,
        uint256 salePrice,
        uint256 minDivision
    ) external virtual override onlyProxy {
        DistributionPoolInterface pool = DistributionPoolInterface(poolAddress);
        bool isTreasury = pool.getPoolType() == uint256(PoolType.Treasury);
        address tokenAddress = pool.getParticipationToken();
        require(
            RemoteOwnable(poolAddress).owner() == msg.sender && isTreasury,
            "EXPECT_TREASURY_POOL_OWNER"
        );
        _setSaleProperties(tokenAddress, salePrice, minDivision, false);
    }

    function _balanceValidation(
        uint256 nTokenToBuy,
        address seller,
        address tokenAddress
    ) internal view returns (bool) {
        require(tokenAddress.code.length > 0, "ADDRESS_IS_NOT_CONTRACT");
        IERC20 token = IERC20(tokenAddress);
        //hay q chequear el allowance approved
        return token.balanceOf(seller) >= nTokenToBuy;
    }    
    
    function _allowanceValidation(
        uint256 nTokenToBuy,
        address seller,
        address tokenAddress
    ) internal view returns (bool) {
        IERC20 token = IERC20(tokenAddress);
        //hay q chequear el allowance approved
        return token.allowance(seller, address(this)) >= nTokenToBuy;
    }

    function _transferTo(
        address _to,
        uint256 _amount
    ) internal returns (bool success) {
        success = payable(_to).send(_amount);
    }

    function getRemainingSale(address token_, address seller) public view returns(uint256){
        require(token_.code.length > 0, "ADDRESS_IS_NOT_CONTRACT");
        IERC20 token = IERC20(token_);
        uint256 balance = token.balanceOf(seller);
        uint256 allowance = token.allowance(seller, address(this));
        if (balance < allowance) {
            return balance;
        }
        return allowance;

    }

    function buyToken(
        uint256 nTokenToBuy,
        address seller,
        address tokenAddress
    ) public payable virtual override onlyProxy {
        console.log("ntokenToBuy", nTokenToBuy);
        console.log("seller", seller);
        console.log("tokenAddress", tokenAddress);
        console.log("check require  SALE_IS_LOCKED");
        require(
            !_S.getBool(
                _paaKey(KeyPrefix.tsmLockedSale, seller, tokenAddress)
            ),
            "SALE_IS_LOCKED"
        );
        uint256 _price = _S.getUint256(
            _paaKey(KeyPrefix.tsmSalePrice, seller, tokenAddress)
        );
        uint256 _minDiv = _S.getUint256(
            _paaKey(KeyPrefix.tsmMinDivision, seller, tokenAddress)
        );
        require(
            nTokenToBuy % _minDiv == 0,
            "nTokenToBuy is not divisible by the minimum division part"
        );
        require(
            msg.value == _price.mul(nTokenToBuy).div(_minDiv),
            "ether paid doesnt match expected amount"
        );
        require(
            _balanceValidation(nTokenToBuy, seller, tokenAddress),
            "token amount not available"
        );
        require(
            _allowanceValidation(nTokenToBuy, seller, tokenAddress),
            "token allowance not available"
        );

        IERC20 token = IERC20(tokenAddress);
        token.transferFrom(seller, msg.sender, nTokenToBuy);


        uint256 amountToSeller = msg.value;
        uint256 charge = 0;
        if (_S.getBool(
            _paaKey(KeyPrefix.tsmApplyCommission, seller, tokenAddress)
        )) {
            charge = _S
                .getUint256(_pKey(KeyPrefix.tokenSaleMarketCommission))
                .mul(msg.value)
                .div(10000);
            if (charge > 0){
                amountToSeller = msg.value.sub(charge);
                _transferTo(owner(), charge);
            }
        }
        _transferTo(seller, amountToSeller);

        emit BuyRecord(
            seller,
            msg.sender,
            tokenAddress,
            nTokenToBuy,
            _price,
            msg.value,
            charge
        );
    }

    function _updateLock(address _tokenAddress, bool _status) internal virtual {
        _S.setBool(
            _paaKey(KeyPrefix.tsmLockedSale, msg.sender, _tokenAddress),
            _status
        );
        emit SaleLockStatus(_tokenAddress, msg.sender, _status);
    }

    function lockSale(address tokenAddress) external override onlyProxy {
        _updateLock(tokenAddress, true);
    }

    function unlockSale(address tokenAddress) external override onlyProxy {
        _updateLock(tokenAddress, false);
    }

    function _setImplementation(
        address newImplementation
    ) internal virtual override {
        _S.setAddress(_getImplementationSlot(), newImplementation);
    }

    function getImplementation()
        public
        view
        virtual
        override
        returns (address)
    {
        return _S.getAddress(_getImplementationSlot());
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override onlyOwner {}

    function getSaleProperties(
        address tokenAddress
    )
        external
        view
        override
        returns (
            uint256 salePrice,
            uint256 minDivision,
            bool applyCommission,
            bool lockStatus
        )
    {
        salePrice = _S.getUint256(
            _paaKey(KeyPrefix.tsmSalePrice, msg.sender, tokenAddress)
        );
        minDivision = _S.getUint256(
            _paaKey(KeyPrefix.tsmMinDivision, msg.sender, tokenAddress)
        );
        applyCommission = _S.getBool(
            _paaKey(KeyPrefix.tsmApplyCommission, msg.sender, tokenAddress)
        );
        lockStatus = _S.getBool(
            _paaKey(KeyPrefix.tsmLockedSale, msg.sender, tokenAddress)
        );
    }

    function estimatePrice(address tokenAddress, address seller, uint256 nTokens) public view returns(uint256){
        return _S.getUint256(
            _paaKey(KeyPrefix.tsmSalePrice, seller, tokenAddress)
        ).mul(nTokens).div(
            _S.getUint256(
                _paaKey(KeyPrefix.tsmMinDivision, seller, tokenAddress)
            )
        );
    }

    function updateFee(uint256 newFee) public onlyOwner onlyProxy {
        _S.setUint256(
            _pKey(KeyPrefix.tokenSaleMarketCommission),
            newFee
        );
        emit FeeUpdate(newFee);
    }
}
