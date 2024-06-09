// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

// library imports
// import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

// relative contract imports
import "../storage/AccessStorageOwnableInitializable.sol";
import "../core/LogicProxiable.sol";

// relative interface imports
import "../../interface/dob/DistributionPoolInterface.sol";

//types imports
// import "../../types/PoolAddresses.sol";
// import "../../types/PoolVariables.sol";
import "../../types/KeyPrefix.sol";
import "../../types/DepositSource.sol";
import "../../types/DataType.sol";
import "../../types/PoolType.sol";
import "hardhat/console.sol";

//utils
// import "../storage/AccessStorageInitializable.sol";

abstract contract BasePool is
    DistributionPoolInterface,
    AccessStorageOwnableInitializable,
    LogicProxiable
{
    using SafeMath for uint256;

    // events
    event addRecord(
        address executor,
        address fromTo,
        DepositSource source,
        DataType dtype,
        uint256 amount,
        uint256 total
    );
    event addRecordToken(
        address executor,
        address externalToken,
        address fromTo,
        DepositSource source,
        DataType dtype,
        uint256 amount,
        uint256 total
    );
    event subRecord(
        address executor,
        address fromTo,
        DataType dtype,
        uint256 amount,
        uint256 total
    );
    event subRecordToken(
        address executor,
        address externalToken,
        address fromTo,
        DataType dtype,
        uint256 amount,
        uint256 total
    );
    event updateDistributionDate(
        address token,
        uint256 lastDist,
        uint256 nextDist
    );
    event updateOperationalAddress(address executor, address operational);
    event updateLinearRegression(
        address executor,
        uint256 coef,
        uint256 intercept
    );
    event updateExternalTokenInfo(address executor, address tokenAddress);
    event updateKeyString(address executor, string key, string value);
    event updateGoal(address executor, address token, uint256 goal);

    //******************************* */
    // modifiers
    modifier isAdmin() {
        require(
            msg.sender == owner() || msg.sender == getOperationalAddress(),
            "You are not admin"
        );
        _;
    }

    modifier isParticipant() {
        bool _isParticipant;
        uint256 _balance;

        (_isParticipant, _balance) = _hasParticipation(msg.sender);

        require(_isParticipant, "You have no participation");
        _;
    }

    modifier hasAccess() {
        bool _isParticipant;
        uint256 _balance;

        (_isParticipant, _balance) = _hasParticipation(msg.sender);

        require(
            _isParticipant ||
                owner() == msg.sender ||
                getOperationalAddress() == msg.sender,
            "You have no access"
        );
        _;
    }

    modifier distributePermissions() {
        uint256 _poolType = _S.getUint256(_pKey(KeyPrefix.poolType));
        if (_poolType == uint256(PoolType.Reward)) {
            require(
                msg.sender == owner(),
                "Only owner can distribute Reward pools"
            );
        }
        _;
    }

    //******************************* */
    // internal functions

    /**
     *
     * @param _addresses list of addresses related to this pool
     *              in order: [operational,treasury,token]
     * @param _vars list of uint256 variables related to this pool
     *              in order: [commission, coef, intercept, nDistributions,
     *                          firstDistributionDate, distributionInterval, goalAmount, poolType]
     */
    function __base_init(
        address[4] memory _addresses,
        uint256[8] memory _vars
    ) internal onlyInitializing {
        // LOGIC INIT
        // _S.setString(_pKey(KeyPrefix.poolName), _poolName); // legacy

        // ADDRESS INIT
        _setOperationalAddress(_addresses[0]);
        _S.setAddress(_pKey(KeyPrefix.treasury), _addresses[1]);
        _S.setAddress(_pKey(KeyPrefix.participationToken), _addresses[2]);

        // VARIABLES INIT
        _setRegressionParams(_vars[1], _vars[2]);
        _S.setUint256(_pKey(KeyPrefix.commission), _vars[0]);

        // POOL TYPE
        _S.setUint256(_pKey(KeyPrefix.poolType), _vars[7]);
    }

    function _hasParticipation(
        address userAddress
    ) internal view returns (bool, uint256) {
        IERC20 token = IERC20(getParticipationToken());
        uint256 balance = token.balanceOf(userAddress);
        if (balance > 0) {
            return (true, balance);
        } else {
            return (false, 0);
        }
    }

    function _sendTo(
        address _to,
        uint256 _amount
    ) internal returns (bool success) {
        if (_to.code.length > 0) {
            (success, ) = payable(_to).call{value: _amount}("");
        } else {
            success = payable(_to).send(_amount);
        }
    }

    function _sendDistributionTo(address _to, address _token) internal {
        bool success;
        // takes care of the reentracy attacks
        // by reducing the storage variable before send
        uint256 amountToSend = getStateVariableTokenUserUint256(
            uint256(KeyPrefix.userCurrent),
            _token,
            _to
        );

        uint256 dist = getStateVariableTokenUint256(
            uint256(KeyPrefix.distribution),
            _token
        );
        require(
            amountToSend > 0 && dist >= amountToSend,
            "Insufficient balance"
        );
        dist = dist.sub(amountToSend);
        _S.setUint256(_ptuKey(KeyPrefix.userCurrent, _token, _to), 0);
        _S.setUint256(_ptKey(KeyPrefix.distribution, _token), dist);
        if (_token != address(0)) {
            IERC20 externalToken = IERC20(_token);
            success = externalToken.transfer(_to, amountToSend);
        } else {
            success = _sendTo(_to, amountToSend);
        }
        // after send check success
        if (success) {
            // if success, emit events
            emit subRecordToken(
                msg.sender,
                _token,
                msg.sender,
                DataType.UserDistribute,
                amountToSend,
                0
            );
            emit subRecordToken(
                msg.sender,
                _token,
                msg.sender,
                DataType.Distribute,
                amountToSend,
                dist
            );
            if (_token == address(0)) {
                emit subRecordToken(
                    msg.sender,
                    _token,
                    msg.sender,
                    DataType.CurrentAmount,
                    amountToSend,
                    getEffectiveBalance()
                );
            }
        } else {
            // otherwise, restore variable
            _S.setUint256(
                _ptuKey(KeyPrefix.userCurrent, _token, _to),
                amountToSend
            );
        }
    }

    function _setOperationalAddress(address newOperational) internal {
        _S.setAddress(_pKey(KeyPrefix.operational), newOperational);
        // emit event
        emit updateOperationalAddress(msg.sender, newOperational);
    }

    function _setRegressionParams(uint256 coef, uint256 intercept) internal {
        _S.setUint256(_pKey(KeyPrefix.coef), coef);
        _S.setUint256(_pKey(KeyPrefix.intercept), intercept);
        // emit event
        emit updateLinearRegression(msg.sender, coef, intercept);
    }

    function _setKeyString(
        address _sender,
        string memory key,
        string memory value
    ) internal {
        _S.setString(_sKey(key), value);
        emit updateKeyString(_sender, key, value);
    }

    //******************************* */
    // payables (deposits)

    /**
     * receive deposit in chain currency
     */
    receive() external payable {
        emit addRecordToken(
            msg.sender,
            address(0),
            address(this),
            DepositSource.Metamask,
            DataType.CurrentAmount,
            msg.value,
            getEffectiveBalance()
        );
    }

    /**
     * deposit to pool in chain currency
     */
    function deposit() external payable override {
        emit addRecordToken(
            msg.sender,
            address(0),
            address(this),
            DepositSource.Platform,
            DataType.CurrentAmount,
            msg.value,
            getEffectiveBalance()
        );
    }

    /**
     * deposit to pool prepay in chain currency
     */
    function depositPrepay() external payable override {
        uint256 prepay = getPrepayAmount();
        prepay = prepay.add(msg.value);
        _S.setUint256(_pKey(KeyPrefix.prepay), prepay);

        emit addRecordToken(
            msg.sender,
            address(0),
            address(this),
            DepositSource.Platform,
            DataType.PrePay,
            msg.value,
            prepay
        );
    }

    //******************************* */
    // withdraws

    function withdrawToken(address _token) public override isParticipant {
        _sendDistributionTo(msg.sender, _token);
    }

    function withdrawTokenCommissions(address _token) public override isAdmin {
        _sendDistributionTo(_S.getAddress(_pKey(KeyPrefix.treasury)), _token);
    }

    function withdrawPrepay() public override onlyOwner {
        uint256 prepay = _S.getUint256(_pKey(KeyPrefix.prepay));
        require(prepay > 0, "Insufficient balance");
        _S.setUint256(_pKey(KeyPrefix.prepay), 0);

        bool success = _sendTo(msg.sender, prepay);
        if (success) {
            emit subRecordToken(
                msg.sender,
                address(0),
                msg.sender,
                DataType.PrePay,
                prepay,
                0
            );
        } else {
            _S.setUint256(_pKey(KeyPrefix.prepay), prepay);
        }
    }

    //******************************* */
    // setters

    function setRegressionParams(
        uint256 coef,
        uint256 intercept
    ) public override onlyOwner {
        _setRegressionParams(coef, intercept);
    }

    function setOperationalAddress(
        address newOperational
    ) public override onlyOwner {
        _setOperationalAddress(newOperational);
    }

    function setkeyString(
        string memory key,
        string memory value
    ) public override isAdmin {
        _setKeyString(msg.sender, key, value);
    }

    function setGoalAmount(
        uint256 newGoal,
        address token
    ) public override onlyOwner {
        uint256 _poolType = _S.getUint256(_pKey(KeyPrefix.poolType));
        if (_poolType == uint256(PoolType.Treasury)){
            require(newGoal == 0, "CANNOT SET GOAL > 0 FOR TREASURY POOL");
        } else if (_poolType == uint256(PoolType.Payroll)){
            require(newGoal > 0, "MUST SET A GOAL > 0 FOR PAYROLL POOL");
        }

        _S.setUint256(_ptKey(KeyPrefix.goalAmount, token), newGoal);
        emit updateGoal(msg.sender, token, newGoal);
    }

    //******************************* */
    // getters

    function getEffectiveBalance() public view override returns (uint256) {
        return
            address(this).balance.sub(getPrepayAmount()).sub(
                getStateVariableUint256(uint256(KeyPrefix.gas))
            );
    }

    function getUserAmounts(
        address _userAddress,
        address _token
    ) external view override returns (uint256) {
        return
            getStateVariableTokenUserUint256(
                uint256(KeyPrefix.userCurrent),
                _token,
                _userAddress
            );
    }

    function getPrepayAmount() public view override returns (uint256) {
        return getStateVariableUint256(uint256(KeyPrefix.prepay));
    }

    function getOperationalAddress()
        public
        view
        virtual
        override
        returns (address)
    {
        return getStateVariableAddress(uint256(KeyPrefix.operational));
    }

    function getParticipationToken() public view override returns (address) {
        return getStateVariableAddress(uint256(KeyPrefix.participationToken));
    }

    function getTreasuryAddress() public view override returns (address) {
        return getStateVariableAddress(uint256(KeyPrefix.treasury));
    }

    function getRegressionParams()
        public
        view
        override
        returns (uint256 _coef, uint256 _intercept)
    {
        _coef = getStateVariableUint256(uint256(KeyPrefix.coef));
        _intercept = getStateVariableUint256(uint256(KeyPrefix.intercept));
    }

    function getCommission()
        public
        view
        override
        returns (uint256 _commision, uint256 _factor)
    {
        _commision = getStateVariableUint256(uint256(KeyPrefix.commission));
        _factor = 10000;
    }

    function getGoalAmount(
        address token
    ) public view override returns (uint256) {
        return
            getStateVariableTokenUint256(uint256(KeyPrefix.goalAmount), token);
    }

    function getPoolType() public view override returns (uint256) {
        return getStateVariableUint256(uint256(KeyPrefix.poolType));
    }

    function _getStateVariableUint256(
        KeyPrefix _prefix
    ) internal view returns (uint256) {
        return _S.getUint256(_pKey(_prefix));
    }

    function getStateVariableUint256(
        uint256 _keyType
    ) public view override returns (uint256) {
        return _getStateVariableUint256(KeyPrefix(_keyType));
    }

    function getStateVariableAddress(
        uint256 _keyType
    ) public view override returns (address) {
        return _S.getAddress(_pKey(KeyPrefix(_keyType)));
    }

    function getStateVariableTokenUint256(
        uint256 _keyType,
        address _token
    ) public view override returns (uint256) {
        return _S.getUint256(_ptKey(KeyPrefix(_keyType), _token));
    }

    function getStateVariableTokenUserUint256(
        uint256 _keyType,
        address _token,
        address _user
    ) public view override returns (uint256) {
        return _S.getUint256(_ptuKey(KeyPrefix(_keyType), _token, _user));
    }

    function getKeyString(
        string memory key
    ) public view override returns (string memory) {
        return _S.getString(_sKey(key));
    }

    function getPoolVersion()
        public
        pure
        virtual
        override
        returns (string memory)
    {
        return "2.2";
    }
}
