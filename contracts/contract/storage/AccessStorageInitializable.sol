// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;


import "./AccessStorageOwnable.sol";
import "../remote/RemoteInitializable.sol";



abstract contract AccessStorageInitializable is
    AccessStorage,
    RemoteInitializable
{

    function __get_initializing() internal view virtual override returns (bool) {
        return _S.getBool(_sKey("initializable._initializing"));
    }

    function __get_initialized() internal view virtual override returns (uint8) {
        return uint8(_S.getUint256(_sKey("initializable._initialized")));
    }

    function __set_initializing(bool _value) internal virtual override {
        _S.setBool(_sKey("initializable._initializing"), _value);
    }

    function __set_initialized(uint8 _value) internal virtual override {
        _S.setUint256(_sKey("initializable._initialized"), uint256(_value));
    }
}