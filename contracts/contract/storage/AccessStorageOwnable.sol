// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;


import "./AccessStorage.sol";
import "../remote/RemoteOwnable.sol";



abstract contract AccessStorageOwnable is
    AccessStorage,
    RemoteOwnable
{
    constructor(address _storage, string memory _name) AccessStorage(_storage, _name) {
    }

    function owner() public view virtual override returns (address) {
        return _S.getAddress(_sKey("remote.owner"));
    }

    function setOwner(address newOwner) internal virtual override {
        _S.setAddress(_sKey("remote.owner"), newOwner);
    }
}