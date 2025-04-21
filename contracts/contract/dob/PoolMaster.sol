// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

// interfaces
import "../../interface/dob/PoolMasterInterface.sol";
import "../../interface/dob/DistributionPoolInterface.sol";
import "../../interface/dob/ParticipationTokenInterface.sol";
import "../../interface/dob/PoolMasterConfigInterface.sol";

//contracts

import "./ParticipationToken.sol";
import "../core/LogicProxy.sol";

// types
import "../../types/KeyPrefix.sol";
import "../../types/PoolType.sol";
// import "../../types/PoolVariables.sol";
// import "../../types/PoolAddresses.sol";

// utils
import "../storage/AccessStorageOwnableInitializable.sol";
import "../core/LogicProxiable.sol";

// libs
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// import "hardhat/console.sol";

contract PoolMaster is
    AccessStorageOwnableInitializable,
    PoolMasterInterface,
    LogicProxiable
{
    using SafeMath for uint256;
    // factory-pattern events
    event CreatePool(
        address poolStarter,
        address contractAddress,
        address tokenAddress,
        bool isTreasury,
        uint256 logicVersion
    );

    /**************************** */
    /**************************** */
    // modifiers

    modifier TreasuryInitialized() {
        require(
            _S.getAddress(_pKey(KeyPrefix.treasury)) != address(0),
            "TREASURY_POOL_NOT_CREATED"
        );
        _;
    }

    constructor(
        address _storage
    ) AccessStorageOwnableInitializable(_storage, "pool.master") {}

    /**************************** */
    /**************************** */
    // internal functions

    function _setImplementation(
        address newImplementation
    ) internal virtual override {
        _S.setAddress(_getImplementationSlot(), newImplementation);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override onlyOwner {}

    /**
     *
     * @param _addresses list of addresses related to this pool
     *              in order: [operational,treasury,token, owner]
     * @param _vars list of uint256 variables related to this pool
     *              in order: [commission, coef, intercept, nDistributions,
     *                          firstDistributionDate, distributionInterval, goalAmount, poolType]
     */
    function _deployProxyPool(
        address[4] memory _addresses,
        uint256[8] memory _vars,
        uint256 _logicVersion,
        string memory _poolData
    ) internal returns (address) {
        // create proxy of logic contract using latest version
        // then initialize the contract with these variables
        // and return the proxy address
        (address _logic, ) = PoolMasterConfigInterface(getPoolMasterConfig())
            .getLogicVersion(_logicVersion);
        require(_logic != address(0), "NO_LOGIC_SET");
        LogicProxy _proxy = new LogicProxy(address(_S), "participation.pool");
        _S.grantUserRole(address(_proxy));
        bytes memory _data = abi.encodeWithSignature(
            "initialize(string,address[4],uint256[8])",
            _poolData,
            _addresses,
            _vars
        );

        _proxy.initLogicAndCall(_logic, _data);

        return address(_proxy);
    }

    function createParticipationToken(
        address[] calldata users,
        uint256[] calldata shares,
        bool pause
    ) public override returns(address){
        ParticipationToken token = new ParticipationToken(
            "Dob Participation Token",
            "PPT"
        );
        uint256 _sharesLimit = PoolMasterConfigInterface(getPoolMasterConfig())
            .getSharesLimit();

        uint256 _totalShare = 0;
        for (uint256 i = 0; i < shares.length; i++) {
            _totalShare = _totalShare.add(shares[i]);
        }
        require(
            _totalShare < _sharesLimit,
            "total shares cannot be higher than limit"
        );

        token.mint_participants(
            _totalShare, 
            users, 
            shares, 
            pause //  pause tokens, should only apply for payroll pools
        );
        return address(token);
    }

    /**
     * Creates a Dob participation pool that can be
     * configured to be a Treasury, Payroll or Reward pool.
     *
     * @param vars input variables required for the pool configurations, its values are:
     *              [goalAmount, poolType, 
     *              firstDistributionDate, nDistributions, distributionInterval,
     *              isMainTreasury]
     * @param owner the list of initial users on the pool
     * @param poolData optional initial data needed by external systems to work properly.
     *               Expected in the form of a json serialized string. Some known keywords are:
     *              - name: for the name of the pool, can be any string
     *              - excludeFromPlatform: set to 1 if want to exclude this pool from platform
     *              - mode: for the distribution mode, can be "Automatic" or "Manual"
     */
    function _creatGeneralParticipationPool(
        address owner,
        uint256[6] memory vars,
        string calldata poolData,
        address token
    ) internal returns (address){
        PoolMasterConfigInterface pmConfig = PoolMasterConfigInterface(
            getPoolMasterConfig()
        );

        ///&&&&&&&&&&&&&&&&&&&&&&&&&&&&&
        // prepare addresses array, final result is
        // [operationalAddress, treasuryPoolAddress, participationTokenAddress, ownerAddress]

        address[4] memory _addresses = [
            pmConfig.getOperationalAddress(),
            vars[5] != 0 ? address(0) : getTreasuryPool(),
            token,
            vars[5] != 0 ? owner : msg.sender
        ];

        ///&&&&&&&&&&&&&&&&&&&&&&&&&&&&&
        // prepar vars array, final result is
        // [commission, coef, intercept, nDistributions,
        //  firstDistributionDate, distributionInterval, goalAmount, poolType]

        (uint256 coef, uint256 intercept, ) = pmConfig.getRegressionParams();
        uint256[8] memory _vars = [
            vars[5] != 0 ? 0 : pmConfig.getCommission(),
            coef,
            intercept,
            vars[3],
            vars[2],
            vars[4],
            vars[0],
            vars[5] != 0 ? 0 : vars[1]
        ];

        ///&&&&&&&&&&&&&&&&&&&&&&&&&&&&&
        // deploy the proxy pool
        address poolAddress = _deployProxyPool(
            _addresses,
            _vars,
            pmConfig.getLatestVersionNumber(),
            poolData
        );
        // _S.setAddress(_key, poolAddress);
        if (msg.value > 0) {
            // deposit the initial prepayment
            bool success;
            (success, ) = payable(poolAddress).call{value: msg.value}(
                abi.encodeWithSignature("depositPrepay()")
            );
            require(success, "FAILED_TO_DEPOSIT_PREPAY");
        }

        // emit event
        emit CreatePool(
            msg.sender,
            poolAddress,
            _addresses[2],
            false,
            pmConfig.getLatestVersionNumber()
        );

        return poolAddress;
    }

    function _checkParticipationToken(address token) internal view returns (bool) {
        ERC20 t = ERC20(token);
        uint256 _sharesLimit = PoolMasterConfigInterface(getPoolMasterConfig())
            .getSharesLimit();
        require(
            t.totalSupply() <= _sharesLimit, 
            "INVALID_PARTICIPATION_TOKEN");
        require(
            t.decimals() == 0, 
            "INVALID_PARTICIPATION_TOKEN");
        return true;
    }

    /**************************** */
    /**************************** */
    // getters

    function getPoolMasterConfig() public view override returns (address) {
        return _S.getAddress(_pKey(KeyPrefix.pmConfig));
    }

    function getTreasuryPool()
        public
        view
        override
        TreasuryInitialized
        returns (address)
    {
        return _S.getAddress(_pKey(KeyPrefix.treasury));
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

    /**************************** */
    /**************************** */
    // setters

    function setPoolMasterConfig(address _config) external override onlyOwner {
        _S.setAddress(_pKey(KeyPrefix.pmConfig), _config);
    }

    /**************************** */
    /**************************** */
    // deployers

    /**
     * creates a Reward Pool with the following characteristics
     * - only owner of the pool can distribute
     * - allows variable of fixed amount distributions
     * - allows only manual distributions
     * - further configuration data can be stored in poolData
     *
     * @param users the list of initial users on the pool
     * @param shares the shares of each user
     * @param goalAmount the fixed amount to distribute each time, if set to 0, assumes
     *              variable distribution schemes
     * @param poolData optional initial data needed by external systems 
     *              to work properly. Expected in the form of a json 
     *              serialized string. Some known keywords are:
     *              - name(na): for the name of the pool, can be any string
     *              - excludeFromPlatform(ep): set to 1 if want to exclude 
     *                      this pool from platform
     *              - mode(ma): for the distribution mode, set to 1 to use
     *                      manual distributions, set to 0 to use automatic distributions.
     *                      If not set, assumes distribution based on poolType.
     * @param participationToken the address of a prev. existent participation token.
     *              if address is 0x0, then it will create a new participation token using
     *              the inputs users and shares.
     */
    function createRewardPool(
        address[] calldata users,
        uint256[] calldata shares,
        uint256 goalAmount,
        string calldata poolData,
        address participationToken
    ) external payable override {
        if (participationToken == address(0)){
            participationToken = createParticipationToken(
                users, shares, false
            );
        } else {
            // existent participation token must have no more than 'shareLimit' total supply 
            // and 0 decimals
            _checkParticipationToken(participationToken);
        }
        _creatGeneralParticipationPool(
            users[0],
            [goalAmount, uint256(PoolType.Reward), 0, 0, 0, 0],
            poolData,
            participationToken
        );
    }

    function _createPayrollPoolVars(
        uint256[] calldata timeConfig,
        uint256 goalAmount
    ) internal pure returns(uint256[6] memory copyVars){
        if (timeConfig.length == 3) {
            copyVars = [
                goalAmount,
                1,
                timeConfig[0],
                timeConfig[1],
                timeConfig[2],
                0
            ];
        } else if (timeConfig.length == 0) {
            copyVars = [goalAmount, uint256(PoolType.Payroll), 0, 0, 0, 0];
        }
    }

    /**
     * Creates a Payroll pool with the following characteristics
     * - participation token is locked and cannot be 
     *          transferred or sell
     * - allows only fixed amount distributions
     * - allows automatic or manual distributions, this is derived 
     *          from timeConfig
     *      + if timeConfig is empty, then configure a 
     *              manual payrol pool
     *      + if timeConfig has 3 values, then configure an
     *              automatic payrol pool
     *           using these data.
     * - further configuration data can be stored in poolData
     *
     * @param users the list of initial users on the pool
     * @param shares the shares of each user
     * @param timeConfig list with the configuration required to set 
     *          custom intervals for pool distributions. 
     *          This list can have 0 or 3 elements. 
     *          Variables should be:
     *      [firstDistributionDate, nDistributions, distributionInterval]
     * @param goalAmount the fixed amount to distribute each time, must be higher than 0
     * @param poolData optional initial data needed by external systems 
     *              to work properly. Expected in the form of a json 
     *              serialized string. Some known keywords are:
     *              - name(na): for the name of the pool, can be any string
     *              - excludeFromPlatform(ep): set to 1 if want to exclude 
     *                      this pool from platform
     *              - mode(ma): for the distribution mode, set to 1 to use
     *                      manual distributions, set to 0 to use automatic distributions.
     *                      If not set, assumes distribution based on poolType.
     */
    function createPayrollPool(
        address[] calldata users,
        uint256[] calldata shares,
        uint256[] calldata timeConfig,
        uint256 goalAmount,
        string calldata poolData
    ) external payable override {
        require(
            timeConfig.length == 0 || timeConfig.length == 3,
            "timeConfig must have 0 or 3 elements"
        );
        require(
            goalAmount > 0,
            "for payroll pools must specify a goalAmount>0"
        );
        address participationToken = createParticipationToken(
                users, shares, true
            );
        _creatGeneralParticipationPool(
            users[0],
             _createPayrollPoolVars(timeConfig, goalAmount),
            poolData,
            participationToken
        );
    }

    /**
     * Creates a Treasury pool with the following characteristics
     * - only operational address can distribute
     * - only automatic distributions are allowed, 
     *      this is derived from timeConfig
     * - only variable amount can be distributed
     * - further configuration data can be stored in poolData
     * @param users the list of initial users on the pool
     * @param shares the shares of each user
     * @param timeConfig list with the configuration required to set 
     *          custom intervals for pool distributions. 
     *          This list can have 0 or 3 elements. 
     *          Variables should be:
     *      [firstDistributionDate, nDistributions, distributionInterval]
     *
     * @param poolData optional initial data needed by external systems 
     *              to work properly. Expected in the form of a json 
     *              serialized string. Some known keywords are:
     *              - name(na): for the name of the pool, can be any string
     *              - excludeFromPlatform(ep): set to 1 if want to exclude 
     *                      this pool from platform
     *              - mode(ma): for the distribution mode, set to 1 to use
     *                      manual distributions, set to 0 to use automatic distributions.
     *                      If not set, assumes distribution based on poolType.
     */
    function createTreasuryPool(
        address[] calldata users,
        uint256[] calldata shares,
        uint256[] calldata timeConfig,
        string calldata poolData,
        address participationToken
    ) external payable override {
        require(
            timeConfig.length == 0 || timeConfig.length == 3,
            "timeConfig must have 0 or 3 elements"
        );
        if (participationToken == address(0)){
            participationToken = createParticipationToken(
                users, shares, false
            );
        } else {
            // existent participation token must have no more than 'shareLimit' total supply 
            // and 0 decimals
            _checkParticipationToken(participationToken);
        }
        _creatGeneralParticipationPool(
            users[0],
            [
                0,
                uint256(PoolType.Treasury),
                timeConfig.length == 3 ? timeConfig[0] : 0,
                timeConfig.length == 3 ? timeConfig[1] : 0,
                timeConfig.length == 3 ? timeConfig[2] : 0,
                0
            ],
            poolData,
            participationToken
        );
    }

    function createPoolMasterTreasuryPool(
        address[] calldata users,
        uint256[] calldata shares,
        string calldata poolData
    ) public payable override onlyOwner {
        require(
            !_S.getBool(_pKey(KeyPrefix.treasury)),
            "TREASURY_ALREADY_CREATED"
        ); 

        uint256[6] memory vars = [
            0,
            uint256(PoolType.Treasury),
            block.timestamp,
            1200,
            2419200,
            1
        ];
        //'{"name": "Pool Master Treasury", "mode": "Manual"}'
        address token = createParticipationToken(
            users, shares, false
        );
        address pool = _creatGeneralParticipationPool(users[0], vars, poolData, token);

        _S.setAddress(_pKey(KeyPrefix.treasury), pool);
    }

    /**************************** */
    /**************************** */
    // initializer

    function initialize(
        address _config
    ) public override canInteract initializer {
        __ownable_init();

        _S.setAddress(_pKey(KeyPrefix.pmConfig), _config);
    }
}
