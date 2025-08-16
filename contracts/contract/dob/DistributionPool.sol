// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../types/DepositSource.sol";
import "../../types/DataType.sol";
// import "../../types/PoolAddresses.sol";
// import "../../types/PoolVariables.sol";
import "../../types/KeyPrefix.sol";
import "../../types/PoolType.sol";
import "./BasePool.sol";
// import "hardhat/console.sol";


/**
 * @title DistributionPool
 * @author Francisco Muñoz
 * @notice Contract to manage distribution of a multi-token pool
 *          while using the storage contract for data
 */
contract DistributionPool is BasePool {
    using SafeMath for uint256;

    /**
     * this logic contract should never be initialized
     * the initializations are made in proxy contracts defining the
     * state variables in each proxy
     */
    constructor(
        address _storage
    ) AccessStorageOwnableInitializable(_storage, "distribution.pool") {
        _disableInitializers();
    }

    /**
     * 
     * @param _poolData string name (json serialized) with customized pool data
     * @param _addresses list of addresses related to this pool
     *              in order: [operational,treasury,token,owner]
     * @param _vars list of uint256 variables related to this pool
     *              in order: [commission, coef, intercept, nDistributions,
     *                          firstDistributionDate, distributionInterval,goalAmount, poolType]
     */
    function initialize(
        string memory _poolData,
        address[4] memory _addresses,
        uint256[8] memory _vars
    ) public initializer {
        // checks
        // check that poolType is a known type
        // the current list is
        // Treasury (0), Payroll (1), Reward (2)
        require(_vars[7] < 3, "unkown poolType");
        // console.log("start initializer", msg.sender, _poolName);
        // ownable init
        _transferOwnership(_addresses[3]);

        // initialize base logic
        __base_init(_addresses, _vars);
        _setKeyString(address(0), "poolData", _poolData);

        // add chain currency for distributions
        _addDistConfig(
            address(0),
            _vars[4],
            _vars[3],
            _vars[5],
            _vars[6]
        );
    }

    //******************************* */
    // internal functions

    function _getDistributionDate(
        uint256 nInterval,
        address _token
    ) internal view returns (uint256) {
        if (
            getStateVariableTokenUint256(uint256(KeyPrefix.nDistributions), _token) <= nInterval
        ) {
            return 0;
        }
        uint256 r = getStateVariableTokenUint256(uint256(KeyPrefix.distributionInterval), _token);
        return
            getStateVariableTokenUint256(uint256(KeyPrefix.firstDistributionDate), _token).add(
                r.mul(nInterval)
            );
    }

    function _updateNextDistribution(address _token) internal {
        // move the index on distributions to next matching date

        // first set the last distribution to current date
        uint256 currT = block.timestamp;
        uint initialLen = getStateVariableTokenUint256(uint256(KeyPrefix.nDistributions), _token);

        //find the index where its date is higher than current date;
        uint index;
        for (index = 0; index < initialLen; index++) {
            if (_getDistributionDate(index, _token) > currT) {
                break;
            }
        }
        uint256 nextDistDate;
        if (index >= initialLen) {
            // this means we didnt found a match
            nextDistDate = 0;
        } else {
            nextDistDate = _getDistributionDate(index, _token);
        }
        // update previous distribution time with current time
        _S.setUint256(_ptKey(KeyPrefix.prevDistributionDate, _token), currT);
        // then update the index on lastDistributionDate
        _S.setUint256(_ptKey(KeyPrefix.index, _token), index);
        // nextDistributionDate will always be equal to _getDistributionDate(index)
        // unless index >= initialLen

        emit updateDistributionDate(_token, currT, nextDistDate);
    }

    /**
     * process a new distribution, first checking the total amount to distribute
     * then checking prepay, and finally asociating distribution amounts to each participant
     * @param usersAddress list of user address that has participation
     * @param totalParticipation the total number of participation tokens
     * @param _token The external token address to use, if is 0x0, then use chain currency
     */
    function _processDistribution(
        address[] calldata usersAddress,
        uint256 totalParticipation,
        address _token
    ) internal {
        (uint256 commissionAmount, uint256 totalAmount) = _getDistributionAmounts(_token);
        // ---------------------
        // gas estimation
        uint256 amount = 0;
        if (msg.sender == getOperationalAddress() && getTreasuryAddress() != address(0)) {
            amount = _getGasCost(usersAddress.length);
        }
        uint256 prepay = _S.getUint256(_pKey(KeyPrefix.prepay));
        uint256 gas = _S.getUint256(_pKey(KeyPrefix.gas));
        require(
            prepay >= amount,
            "Not enough prepay to pay for distribution gas"
        );
        prepay = prepay.sub(amount);
        gas = gas.add(amount);
        _S.setUint256(_pKey(KeyPrefix.prepay), prepay);
        _S.setUint256(_pKey(KeyPrefix.gas), gas);

        emit subRecordToken(
            msg.sender, 
            address(0),
            address(this),
            DataType.PrePay,
            amount,
            prepay
        );
        emit addRecordToken(
            msg.sender, 
            address(0),
            address(this),
            DepositSource.Internal,
            DataType.GasCost,
            amount,
            gas
        );
        // ---------------------
        // distribution to users and treasury
        // commission is a number that lives between 0 and 10.000
        // which means that it allows up to 2 decimals

        bool hasBalance;
        for (uint i = 0; i < usersAddress.length; i++) {
            // distribute to this user
            (hasBalance, amount) = _hasParticipation(usersAddress[i]);
            amount = amount.mul(totalAmount).div(totalParticipation);
            // we have already checked that the sum of all users participations
            // is equal to totalParticipation, so we dont need to
            // verify the amounts here
            _distributeToAddress(usersAddress[i], amount, _token);
        }

        if (commissionAmount > 0) {
            // check if it has commission
            // distribute to commission
            _distributeToAddress(
                _S.getAddress(_pKey(KeyPrefix.treasury)),
                commissionAmount,
                _token
            );
        }
        uint256 dist = getStateVariableTokenUint256(uint256(KeyPrefix.distribution), _token);
        dist = dist.add(totalAmount.add(commissionAmount));
        _S.setUint256(_ptKey(KeyPrefix.distribution, _token), dist);

        emit addRecordToken(
            msg.sender,
            _token,
            _token,
            DepositSource.Internal,
            DataType.Distribute,
            totalAmount.add(commissionAmount),
            dist
        );
    }

    /**
     * send the given mount to the specified address variables
     * that stores the available amount to withdraw
     * @param _to The target address to distribute
     * @param amount the amount to distribute
     * @param _token The external token to distribute, if 0x0 then use chain currency
     */
    function _distributeToAddress(
        address _to,
        uint256 amount,
        address _token
    ) internal {
        uint256 userCurrent = getStateVariableTokenUserUint256(uint256(KeyPrefix.userCurrent), _token, _to);
        userCurrent = userCurrent.add(amount);
        _S.setUint256(_ptuKey(KeyPrefix.userCurrent, _token, _to), userCurrent);

        emit addRecordToken(
            msg.sender,
            _token,
            _to,
            DepositSource.Internal,
            DataType.UserDistribute,
            amount,
            userCurrent
        );
    }

    function _getTotalParticipation(
        address[] calldata usersAddress
    ) internal view returns (uint256 total, bool full) {
        total = 0;
        bool hasBalance;
        uint256 balance;
        for (uint i = 0; i < usersAddress.length; i++) {
            (hasBalance, balance) = _hasParticipation(usersAddress[i]);
            require(hasBalance, "User address has no participation");
            total += balance;
        }
        IERC20 token = IERC20(
            _S.getAddress(_pKey(KeyPrefix.participationToken))
        );
        full = total == token.totalSupply();
    }

    function _addDistConfig(
        address _newToken,
        uint256 _firstDistributionDate,
        uint256 _nDistributions,
        uint256 _distributionInterval,
        uint256 _goalAmount
    ) internal {
        _S.setBool(_ptKey(KeyPrefix.externalTokenExists, _newToken), true);
        _S.setUint256(
            _ptKey(KeyPrefix.firstDistributionDate, _newToken),
            _firstDistributionDate
        );
        _S.setUint256(
            _ptKey(KeyPrefix.nDistributions, _newToken),
            _nDistributions
        );
        _S.setUint256(
            _ptKey(KeyPrefix.distributionInterval, _newToken),
            _distributionInterval
        );
        _S.setUint256(_ptKey(KeyPrefix.index, _newToken), 0);
        _S.setUint256(_ptKey(KeyPrefix.goalAmount, _newToken), _goalAmount);

        emit updateExternalTokenInfo(msg.sender, _newToken);
    }

    function _setImplementation(
        address newImplementation
    ) internal override {
        _S.setAddress(_getImplementationSlot(), newImplementation);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    function _getDistributionAmounts(
        address token
    ) internal view returns(
        uint256 commissionValue,
        uint256 efectiveValue
    ) {
        uint totalAmount = getTotalDistAmount(token);
        uint goalAmount = getGoalAmount(token);
        // checks amount over goal, if goal is not set, it should be 0
        require(totalAmount > goalAmount, "There is no amount to distribute");
        // if goal is set (i.e, >0), then use the goal for distribution
        // instead of the total amount
        if (goalAmount > 0){
            totalAmount = goalAmount;
        }
        commissionValue = totalAmount
            .mul(_S.getUint256(_pKey(KeyPrefix.commission)))
            .div(10000);
        efectiveValue = totalAmount.sub(commissionValue);
    }

    function _getGasCost(
        uint256 nUsers
    ) internal view returns(
        uint256 gasCost
    ) {
        gasCost = tx.gasprice.mul(
                _S
                    .getUint256(_pKey(KeyPrefix.coef))
                    .mul(nUsers)
                    .add(_S.getUint256(_pKey(KeyPrefix.intercept)))
            );
    }

    //******************************* */
    // distribute functions

    function canDistribute(address _token) public view override virtual returns (bool) {
        uint256 currT = block.timestamp;
        // ***********************
        // use this line for special test
        // bool conditionLast =
        //     _S.getUint(_ptKey("prevDistributionDate", _token)) <= currT;
        // ***********************
        // use this line for production
        bool conditionLast = getStateVariableTokenUint256(
            uint256(KeyPrefix.prevDistributionDate), _token
        ).add(12 hours) <= currT;
        // console.log("conditionLast", conditionLast);
        // console.log("prevDistributionDate", _S.getUint256(
            // _ptKey(KeyPrefix.prevDistributionDate, _token)
        // ));
        // console.log("indexTime < currT", _getDistributionDate(
        //             _S.getUint256(_ptKey(KeyPrefix.index, _token)),
        //             _token
        //         ) <=
        //         currT);
        // ***********************
        return (conditionLast &&
            _getDistributionDate(
                _S.getUint256(_ptKey(KeyPrefix.index, _token)),
                _token
            ) <=
            currT);
    }

    function distribute(
        address[] calldata userList,
        address _token
    ) public override distributePermissions {
        require(
            _token == address(0) || _S.getBool(_ptKey(KeyPrefix.externalTokenExists, _token)),
            "token is not set for distribution");
        (uint256 _total, bool isFull) = _getTotalParticipation(userList);
        require(isFull, "Must Match 100% participation to distribute");
        require(
            canDistribute(_token),
            "Cannot distribute in the current timestamp"
        );
        _processDistribution(userList, _total, _token);
        _updateNextDistribution(_token);
    }

    //******************************* */
    // configure tokens

    function addExternalToken(address _newToken) public hasAccess {
        require(
            !_S.getBool(_ptKey(KeyPrefix.externalTokenExists, _newToken)),
            "External token already set"
        );
        _addDistConfig(
            _newToken,
            _S.getUint256(_ptKey(KeyPrefix.firstDistributionDate, address(0))),
            _S.getUint256(_ptKey(KeyPrefix.nDistributions, address(0))),
            _S.getUint256(_ptKey(KeyPrefix.distributionInterval, address(0))),
            _S.getUint256(_ptKey(KeyPrefix.goalAmount, address(0)))
        );
    }

    function addExternalTokenWithGoalAmount(address _newToken, uint256 _goal) external hasAccess {
        addExternalToken(_newToken);
        setGoalAmount(_goal, _newToken);
    }

    function addExternalTokenWithConfig(
        address _newToken,
        uint256 firstDistributionDate,
        uint256 nDistributions,
        uint256 distributionInterval,
        uint256 goalAmount
    ) external hasAccess {
        require(
            !_S.getBool(_ptKey(KeyPrefix.externalTokenExists, _newToken)),
            "External token already set"
        );
        _addDistConfig(
            _newToken,
            firstDistributionDate,
            nDistributions,
            distributionInterval,
            goalAmount
        );
    }


    //******************************* */
    // getters


    function getTotalDistAmount(
        address token
    ) public view returns (uint256) {
        if (token == address(0)) {
            // console.log("getTotalDistAmount_balance", address(this).balance);
            // console.log("getTotalDistAmount_prepay", _S.getUint256(_pKey(KeyPrefix.prepay)));
            // console.log("getTotalDistAmount_distribution", _S.getUint256(_ptKey(KeyPrefix.distribution, _token)));
            return
                getEffectiveBalance() - 
                _S.getUint256(_ptKey(KeyPrefix.distribution, token));
        }
        return IERC20(token).balanceOf(address(this)) - 
                _S.getUint256(_ptKey(KeyPrefix.distribution, token));
    }


    function getDistributionDates(
        address _token
    )
        external
        view
        returns (
            uint256 firstDistributionDate,
            uint256 nDistributions,
            uint256 distributionInterval,
            uint256 index
        )
    {
        firstDistributionDate = _S.getUint256(
            _ptKey(KeyPrefix.firstDistributionDate, _token)
        );
        nDistributions = _S.getUint256(
            _ptKey(KeyPrefix.nDistributions, _token)
        );
        distributionInterval = _S.getUint256(
            _ptKey(KeyPrefix.distributionInterval, _token)
        );
        index = _S.getUint256(_ptKey(KeyPrefix.index, _token));
    }

    /**
     * get implementation address
     * function part of the LogicProxiable abstract contract
     */
    function getImplementation()
        public
        view
        override
        returns (address)
    {
        return _S.getAddress(_getImplementationSlot());
    }

    function getDistributionAmounts(
        address token, uint256 nUsers
    )
        external
        view
        returns (
            uint256 gasCost,
            uint256 commissionValue,
            uint256 efectiveValue
        )
    {
        (commissionValue, efectiveValue) = _getDistributionAmounts(token);
        gasCost = _getGasCost(nUsers);
    }



}