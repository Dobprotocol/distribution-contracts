// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

interface DistributionPoolInterface {
    // initializwer
    function initialize(
        string memory _poolData,
        address[4] memory _addresses,
        uint256[8] memory _vars
    ) external;

    //******************************* */
    // distribution
    function canDistribute(address _token) external view returns (bool);

    function distribute(address[] memory userList, address _token) external;

    //******************************* */
    // deposits
    function deposit() external payable;

    function depositPrepay() external payable;

    //******************************* */
    // withdraw
    function withdrawToken(address _token) external;

    function withdrawTokenCommissions(address _token) external;

    function withdrawPrepay() external;

    //****************************ssssss*** */
    // getters

    function getStateVariableUint256(
        uint256 _keyType
    ) external view returns (uint256);

    function getStateVariableAddress(
        uint256 _keyType
    ) external view returns (address);

    function getStateVariableTokenUint256(
        uint256 _keyType,
        address _token
    ) external view returns (uint256);

    function getStateVariableTokenUserUint256(
        uint256 _keyType,
        address _token,
        address _user
    ) external view returns (uint256);

    function getUserAmounts(
        address _userAddress,
        address _token
    ) external view returns (uint256);

    function getPrepayAmount() external view returns (uint256);

    function getOperationalAddress() external view returns (address);

    function getParticipationToken() external view returns (address);

    function getEffectiveBalance() external view returns (uint256);

    function getTreasuryAddress() external view returns (address);

    function getRegressionParams()
        external
        view
        returns (uint256 _coef, uint256 _intercept);

    function getCommission()
        external
        view
        returns (uint256 _commision, uint256 _factor);

    function getKeyString(
        string memory key
    ) external view returns (string memory);

    function getGoalAmount(address token) external view returns (uint256);

    function getPoolType() external view returns (uint256);

    function getTotalDistAmount(address token) external view returns (uint256);

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
        );

    function getDistributionAmounts(
        address token,
        uint256 nUsers
    )
        external
        view
        returns (
            uint256 gasCost,
            uint256 commissionValue,
            uint256 efectiveValue
        );

    function getPoolVersion() external pure returns (string memory);

    //******************************* */
    // setters
    function setOperationalAddress(address newOperational) external;

    function setRegressionParams(uint256 coef, uint256 intercept) external;

    function setkeyString(string memory key, string memory value) external;

    function setGoalAmount(uint256 newGoal, address token) external;

    //******************************* */
    // configure tokens
    function addExternalToken(address _newToken) external;

    function addExternalTokenWithConfig(
        address _newToken,
        uint256 firstDistributionDate,
        uint256 nDistributions,
        uint256 distributionInterval,
        uint256 goalAmount
    ) external;
}
