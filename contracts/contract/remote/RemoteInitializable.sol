// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/utils/Address.sol";

// library imports
import "@openzeppelin/contracts/utils/Context.sol";

import "hardhat/console.sol";

abstract contract RemoteInitializable {
    /**
     * @dev Triggered when the contract has been initialized or reinitialized.
     */
    event Initialized(uint8 version);

    /**
     * @dev A modifier that defines a protected initializer function that can be invoked at most once. In its scope,
     * `onlyInitializing` functions can be used to initialize parent contracts. Equivalent to `reinitializer(1)`.
     */
    modifier initializer() {
        // console.log("checking initializer");
        bool isTopLevelCall = !__get_initializing();
        uint256 _initialized = __get_initialized();
        // console.log("isTopLevelCall", isTopLevelCall);
        // console.log("_initialized", _initialized);
        require(
            (isTopLevelCall && _initialized < 1) || (!Address.isContract(address(this)) && _initialized == 1),
            "Initializable: contract is already initialized"
        );
        __set_initialized(1);
        if (isTopLevelCall) {
            __set_initializing(true);
        }

        _;
        if (isTopLevelCall) {
            __set_initializing(false);
            emit Initialized(1);
        }
    }

    /**
     * @dev A modifier that defines a protected reinitializer function that can be invoked at most once, and only if the
     * contract hasn't been initialized to a greater version before. In its scope, `onlyInitializing` functions can be
     * used to initialize parent contracts.
     *
     * `initializer` is equivalent to `reinitializer(1)`, so a reinitializer may be used after the original
     * initialization step. This is essential to configure modules that are added through upgrades and that require
     * initialization.
     *
     * Note that versions can jump in increments greater than 1; this implies that if multiple reinitializers coexist in
     * a contract, executing them in the right order is up to the developer or operator.
     */
    modifier reinitializer(uint8 version) {
        require(!__get_initializing() && __get_initialized() < version, "Initializable: contract is already initialized");
        __set_initialized(version);
        __set_initializing(true);
        _;
        __set_initializing(false);
        emit Initialized(version);
    }

    /**
     * @dev Modifier to protect an initialization function so that it can only be invoked by functions with the
     * {initializer} and {reinitializer} modifiers, directly or indirectly.
     */
    modifier onlyInitializing() {
        require(__get_initializing(), "Initializable: contract is not initializing");
        _;
    }

    /**
     * @dev Locks the contract, preventing any future reinitialization. This cannot be part of an initializer call.
     * Calling this in the constructor of a contract will prevent that contract from being initialized or reinitialized
     * to any version. It is recommended to use this to lock implementation contracts that are designed to be called
     * through proxies.
     */
    function _disableInitializers() internal virtual {
        require(!__get_initializing(), "Initializable: contract is initializing");
        if (__get_initialized() < type(uint8).max) {
            __set_initialized(type(uint8).max);
            emit Initialized(type(uint8).max);
        }
    }

    function __get_initializing() internal virtual view returns(bool);
    function __get_initialized() internal virtual view returns(uint8);
    function __set_initializing(bool _value) internal virtual;
    function __set_initialized(uint8 _value) internal virtual;
}