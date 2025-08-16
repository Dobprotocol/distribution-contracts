// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;


// interfaces
import "../../interface/dob/PoolMasterConfigInterface.sol";
import "../../interface/dob/DistributionPoolInterface.sol";
import "../../interface/dob/ParticipationTokenInterface.sol";

//contracts

import "./ParticipationToken.sol";
import "../core/LogicProxy.sol";

// types
import "../../types/KeyPrefix.sol";
// import "../../types/PoolVariables.sol";
// import "../../types/PoolAddresses.sol";

// utils
import "../storage/AccessStorageOwnableInitializable.sol";
import "../core/LogicProxiable.sol";

// libs
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
// import "hardhat/console.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PoolMasterConfig is
    AccessStorageOwnableInitializable,
    PoolMasterConfigInterface,
    LogicProxiable
{
    using SafeMath for uint256;
    // factory-pattern events
    event AddLogicVersion(
        address executor,
        uint256 version,
        address logicAddress
    );

    event UpdateMasterLinearRegression(
        address executor,
        uint256 coef,
        uint256 intercept,
        uint256 gasPrice
    );

    event UpdateMasterOperationalAddress(address executor, address opAddress);

    event UpdateCommission(address executor, uint256 commission);

    constructor(
        address _storage
    ) AccessStorageOwnableInitializable(_storage, "pool.master.config") {
    // do not disable initializers at implementation constructor time, as this contract
    // interacts with EternalStorage which requires roles that are not granted yet during deployment
    }

    function initialize(
        uint256 _coef,
        uint256 _intercept,
        uint256 _gasPrice,
        address _operational,
        uint256 _commission
    ) public initializer {
        __ownable_init();

        _S.setUint256(_pKey(KeyPrefix.coef), _coef);
        _S.setUint256(_pKey(KeyPrefix.intercept), _intercept);
        _S.setUint256(_pKey(KeyPrefix.gasPrice), _gasPrice);
        _S.setAddress(_pKey(KeyPrefix.operational), _operational);
        _S.setUint256(_pKey(KeyPrefix.baseCommissionPool), _commission);
        _S.setUint256(_pKey(KeyPrefix.logicVersion), 0);
        _S.setUint256(_pKey(KeyPrefix.sharesLimit), 300); // for now its fixed to 300
    }

    function getSharesLimit() external view override returns (uint256) {
        return _S.getUint256(_pKey(KeyPrefix.sharesLimit));
    }

    function setSharesLimit(uint256 _sharesLimit) external override onlyOwner {
        _S.setUint256(_pKey(KeyPrefix.sharesLimit), _sharesLimit);
    }

    function getOperationalAddress() external view override returns (address) {
        return _S.getAddress(_pKey(KeyPrefix.operational));
    }

    /**
     * Returns the current commission value
     * Commission are set with 2 decimals, which means a
     * commission value of 156
     * is equal to %1.56 commission
     */
    function getCommission() public view override returns (uint256) {
        return _S.getUint256(_pKey(KeyPrefix.baseCommissionPool));
    }

    function getRegressionParams()
        external
        view
        override
        returns (uint256 coef, uint256 intercept, uint256 gasPrice)
    {
        coef = _S.getUint256(_pKey(KeyPrefix.coef));
        intercept = _S.getUint256(_pKey(KeyPrefix.intercept));
        gasPrice = _S.getUint256(_pKey(KeyPrefix.gasPrice));
    }

    function setOperationalAddress(
        address _newOperational
    ) external override onlyOwner {
        _S.setAddress(_pKey(KeyPrefix.operational), _newOperational);
        // emit event
        emit UpdateMasterOperationalAddress(msg.sender, _newOperational);
    }

    function setRegressionParams(
        uint256 _newCoef,
        uint256 _newIntercept,
        uint256 _newGasPrice
    ) external override onlyOwner {
        _S.setUint256(_pKey(KeyPrefix.coef), _newCoef);
        _S.setUint256(_pKey(KeyPrefix.intercept), _newIntercept);
        _S.setUint256(_pKey(KeyPrefix.gasPrice), _newGasPrice);
        // emit event
        emit UpdateMasterLinearRegression(
            msg.sender,
            _newCoef,
            _newIntercept,
            _newGasPrice
        );
    }

    function setCommission(uint256 _commission) external override onlyOwner {
        _S.setUint256(_pKey(KeyPrefix.baseCommissionPool), _commission);
        emit UpdateCommission(msg.sender, _commission);
    }

    function expectedTotalGas(
        uint256 nUsers,
        uint256 nDistributions
    ) public view override returns (uint256 amount) {
        // equation is totalGas = gasPrice * (_coef * nUser + _intercept) * nDistributions
        // estimate _coef * nUsers
        amount = _S.getUint256(_pKey(KeyPrefix.coef)).mul(nUsers);
        // estimate gasPrice * (amount + _intercept)
        amount = _S.getUint256(_pKey(KeyPrefix.gasPrice)).mul(
            amount.add(_S.getUint256(_pKey(KeyPrefix.intercept)))
        );
        // estimate amount * nDistributions
        amount = amount.mul(nDistributions);
    }

    function addLogicVersion(
        address _logic,
        uint256 _version,
        string memory _logicName
    ) public override onlyOwner {
        require(
            _S.getAddress(_puKey(KeyPrefix.logicVersion, _version)) ==
                address(0),
            "LOGIC_VERSION_ALREADY_EXISTS"
        );
        require(
            getLatestVersionNumber() < _version,
            "LOGIC_VERSION_CAN_ONLY_INCREASE"
        );
        _S.setAddress(_puKey(KeyPrefix.logicVersion, _version), _logic);
        _S.setString(_puKey(KeyPrefix.logicVersion, _version), _logicName);
        _S.setUint256(_pKey(KeyPrefix.logicVersion), _version);

        emit AddLogicVersion(msg.sender, _version, _logic);
    }

    function addLogic(
        address _logic,
        string memory _logicName
    ) external override onlyOwner {
        addLogicVersion(_logic, getLatestVersionNumber().add(1), _logicName);
    }

    function getLogicVersion(
        uint256 _version
    ) public view override returns (address _logic, string memory _name) {
        _logic = _S.getAddress(_puKey(KeyPrefix.logicVersion, _version));
        _name = _S.getString((_puKey(KeyPrefix.logicVersion, _version)));
    }

    function getLatestVersion()
        public
        view
        override
        returns (address _logic, string memory _name)
    {
        (_logic, _name) = getLogicVersion(getLatestVersionNumber());
    }

    function getLatestVersionNumber() public view override returns (uint256) {
        return _S.getUint256(_pKey(KeyPrefix.logicVersion));
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
    
}