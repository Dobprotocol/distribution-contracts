// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

// relative imports
// import "../storage/AccessStorage.sol";

// library imports
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/access/IAccessControl.sol";

/**
 * @title RemoteRoles
 * @author Francisco Muñoz
 * @notice 
 * 
 * contract module that allows childern to implement role-based access using a remote storage
 * such as eternal storage. This module is inspired in AccessControl from openzeppelin
 * but with simplified logic that can easely be stored in an Eternal Storage.
 * 
 * For simplicity, the roles produced here are not enumerable
 */
abstract contract RemoteRoles is IAccessControl, Context {

    /**
     * @dev Modifier that checks that an account has a specific role. Reverts
     * with a standardized message including the required role.
     *
     * The format of the revert reason is given by the following regular expression:
     *
     *  /^AccessControl: account (0x[0-9a-f]{40}) is missing role (0x[0-9a-f]{64})$/
     *
     * _Available since v4.1._
     */
    modifier onlyRole(bytes32 role) {
        _checkRole(role);
        _;
    }

    constructor() {
        __setRole("default.admin.role", 0x00);
        __setRoleAdmin(_buildAdminRoleKey(0x00), 0x00); // admin role is its own admin
    }

    /**
     * returns the default admin role asigned to this contract
     */
    function getDefaultAdminRole() public view returns (bytes32){
        return __getRoleString("default.admin.role");
    }

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) public view virtual returns (bool){
        return __hasRole(_buildRoleKey(role, account));
    }

    /**
     * @dev Revert with a standard message if `_msgSender()` is missing `role`.
     * Overriding this function changes the behavior of the {onlyRole} modifier.
     *
     * Format of the revert message is described in {_checkRole}.
     *
     * _Available since v4.6._
     */
    function _checkRole(bytes32 role) internal view virtual {
        _checkRole(role, _msgSender());
    }

    /**
     * @dev Revert with a standard message if `account` is missing `role`.
     *
     * The format of the revert reason is given by the following regular expression:
     *
     *  /^AccessControl: account (0x[0-9a-f]{40}) is missing role (0x[0-9a-f]{64})$/
     */
    function _checkRole(bytes32 role, address account) internal view virtual {
        if (!hasRole(role, account)) {
            revert(
                string(
                    abi.encodePacked(
                        "AccessControl: account ",
                        Strings.toHexString(uint160(account), 20),
                        " is missing role ",
                        Strings.toHexString(uint256(role), 32)
                    )
                )
            );
        }
    }

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) public view virtual returns (bytes32) {
        return __getRole(_buildAdminRoleKey(role));
    }

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleGranted} event.
     */
    function grantRole(bytes32 role, address account) public virtual override onlyRole(getRoleAdmin(role)) {
        _grantRole(role, account);
    }

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleRevoked} event.
     */
    function revokeRole(bytes32 role, address account) public virtual override onlyRole(getRoleAdmin(role)) {
        _revokeRole(role, account);
    }

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been revoked `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `account`.
     *
     * May emit a {RoleRevoked} event.
     */
    function renounceRole(bytes32 role, address account) public virtual override {
        require(account == _msgSender(), "AccessControl: can only renounce roles for self");

        _revokeRole(role, account);
    }

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event. Note that unlike {grantRole}, this function doesn't perform any
     * checks on the calling account.
     *
     * May emit a {RoleGranted} event.
     *
     * [WARNING]
     * ====
     * This function should only be called from the constructor when setting
     * up the initial roles for the system.
     *
     * Using this function in any other way is effectively circumventing the admin
     * system imposed by {AccessControl}.
     * ====
     *
     * NOTE: This function is deprecated in favor of {_grantRole}.
     */
    function _setupRole(bytes32 role, address account) internal virtual {
        _grantRole(role, account);
    }

    /**
     * @dev Sets `adminRole` as ``role``'s admin role.
     *
     * Emits a {RoleAdminChanged} event.
     */
    function _setRoleAdmin(bytes32 role, bytes32 adminRole) internal virtual {
        bytes32 previousAdminRole = getRoleAdmin(role);
        __setRoleAdmin(role, adminRole);
        emit RoleAdminChanged(role, previousAdminRole, adminRole);
    }

    /**
     * @dev Grants `role` to `account`.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleGranted} event.
     */
    function _grantRole(bytes32 role, address account) internal virtual {
        if (!hasRole(role, account)) {
            __setRoleUser(role, account, true);
            emit RoleGranted(role, account, _msgSender());
        }
    }

    /**
     * @dev Revokes `role` from `account`.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleRevoked} event.
     */
    function _revokeRole(bytes32 role, address account) internal virtual {
        if (hasRole(role, account)) {
            __setRoleUser(role, account, false);
            emit RoleRevoked(role, account, _msgSender());
        }
    }

    /**
     * example:
     * 
     * _S.setBytes32(_sKey("default.admin.role"), 0x00);
     * 
     * @param _key the key to store in eternal storage
     * @param _role the role to store
     */
    function __setRole(string memory _key, bytes32 _role) internal virtual;

    function __getRoleString(string memory _key) internal view virtual returns(bytes32);
    function __getRole(bytes32 _encodedKey) internal view virtual returns(bytes32);
    function __hasRole(bytes32 _encodedKey) internal view virtual returns(bool);

    function __setRoleUser(bytes32 _role, address _user, bool _access) internal virtual;

    /**
     * asign a role as admin of another role
     * example:
     * 
     * _S.setBytes32(_buildAdminRoleKey(role), roleAdmin);
     * 
     * @param _role role to be administrated
     * @param _roleAdmin role to be administrator
     */
    function __setRoleAdmin(bytes32 _role, bytes32 _roleAdmin) internal virtual;

    /**
     * build the eternal storage key used to store the account role permissions
     * example:
     * 
     * return keccak256(abi.encodePacked(_nameSpace, role, account));
     * 
     * @param role the role to use
     * @param account the account to use
     */
    function _buildRoleKey(bytes32 role, address account) internal view virtual returns (bytes32);

    /**
     * build the eternal storage key used to store the admin role asigned to the specified role
     * example:
     * 
     * return keccak256(abi.encodePacked(_nameSpace, role, "admin"));
     * 
     * @param role the specified role
     */
    function _buildAdminRoleKey(bytes32 role) internal view virtual returns (bytes32);
}