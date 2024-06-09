// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "../../interface/StorageInterface.sol";

import "@openzeppelin/contracts/access/AccessControl.sol";

abstract contract EternalStorageRoles is AccessControl, StorageInterface {
    // events
    event GuardianChanged(address oldGuardian, address newGuardian);

    address private guardian;
    bytes32 internal constant ADMIN_ROLE = keccak256("Administrator");
    bytes32 internal constant GUARDIAN_ROLE = keccak256("Guardian");
    bytes32 internal constant USER_ROLE = keccak256("User");

    constructor() {
        _setRoleAdmin(GUARDIAN_ROLE, GUARDIAN_ROLE);
        _setRoleAdmin(ADMIN_ROLE, GUARDIAN_ROLE);
        _setRoleAdmin(USER_ROLE, ADMIN_ROLE);

        _grantRole(GUARDIAN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        guardian = msg.sender;
    }

    function getGuardian() external view override returns (address) {
        return guardian;
    }

    function setGuardian(
        address _newAddress
    ) external override onlyRole(GUARDIAN_ROLE) {
        // Check tx comes from current guardian
        require(msg.sender == guardian, "Is not guardian account");
        // Store new address awaiting confirmation
        _grantRole(GUARDIAN_ROLE, _newAddress);
        _grantRole(ADMIN_ROLE, _newAddress);
        _revokeRole(GUARDIAN_ROLE, msg.sender);
        _revokeRole(ADMIN_ROLE, msg.sender);
        guardian = _newAddress;
        emit GuardianChanged(msg.sender, guardian);
    }

    function grantAdminRole(address account) public override onlyRole(GUARDIAN_ROLE) {
        require(account != msg.sender, "cannot grant lower roles to self!");
        _grantRole(ADMIN_ROLE, account);
    }

    function grantUserRole(address account) public override onlyRole(ADMIN_ROLE) {
        require(account != msg.sender, "cannot grant lower roles to self!");
        _grantRole(USER_ROLE, account);
    }

    function isAdmin(address account) public view override returns(bool){
        return hasRole(ADMIN_ROLE, account);
    }

    function isUser(address account) public view override returns(bool){
        return hasRole(USER_ROLE, account);
    }

    function revokeAdminRole(address account) public override onlyRole(GUARDIAN_ROLE){
        _revokeRole(ADMIN_ROLE, account);
    }

    function revokeUserRole(address account) public override onlyRole(ADMIN_ROLE){
        _revokeRole(USER_ROLE, account);
    }

    function grantRole(
        bytes32 role,
        address account
    ) public override onlyRole(getRoleAdmin(role)) {
        require(
            role != GUARDIAN_ROLE,
            "Eternal Storage role: use setGuardian() to change guardiana address"
        );
        require(account != msg.sender, "cannot grant lower roles to self!");
        super.grantRole(role, account);
    }

    function revokeRole(
        bytes32 role,
        address account
    ) public override onlyRole(getRoleAdmin(role)) {
        require(
            role != GUARDIAN_ROLE,
            "Eternal Storage role: use setGuardian() to change guardiana address"
        );
        if (getRoleAdmin(role) == ADMIN_ROLE) {
            require(msg.sender == guardian, "only guardian can revoke roles!");
        }
        super.revokeRole(role, account);
    }
}