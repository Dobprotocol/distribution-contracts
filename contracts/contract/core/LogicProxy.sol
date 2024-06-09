// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "../../interface/LogicProxyInterface.sol";
import "../../interface/StorageInterface.sol";
import "../storage/AccessStorageOwnableInitializable.sol";
import "@openzeppelin/contracts/proxy/Proxy.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import "../remote/RemoteInitializable.sol";
import "./LogicUpgrade.sol";

contract LogicProxy is LogicProxyInterface, Proxy, AccessStorageOwnableInitializable, LogicUpgrade {


    constructor (address _storage, string memory _name) AccessStorageOwnableInitializable(_storage, _name){
    }

    function initLogic(address _logic) external override canInteract {
        // __ownable_init();
        _upgradeToAndCall(_logic, new bytes(0), false);
    }

    function initLogicAndCall(address _logic, bytes memory _data) external override canInteract {
        // __ownable_init();
        _upgradeToAndCall(_logic, _data, false);
    }

    function isOwner(address _user) external view override returns(bool) {
        return _user == owner();
    }

    function transferOwner(address _newOwner) external override onlyOwner {
        transferOwnership(_newOwner);
    }

    function getLogicAddress() external view override returns (address) {
        return getImplementation();
    }

    function _implementation()
        internal
        view
        virtual
        override
        returns (address)
    {
        return getImplementation();   
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
}