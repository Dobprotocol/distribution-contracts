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


    // namespaced storage keys for init protection
    function _initDeployerKey() internal view returns (bytes32) { return _sKey("proxy.init.deployer"); }
    function _initDoneKey() internal view returns (bytes32) { return _sKey("proxy.init.done"); }

    modifier onlyInitDeployer() {
        require(msg.sender == _S.getAddress(_initDeployerKey()), "INIT_CALLER_NOT_DEPLOYER");
        _;
    }

    modifier notInitializedYet() {
        require(!_S.getBool(_initDoneKey()), "PROXY_ALREADY_INITIALIZED");
        _;
    }

    constructor (address _storage, string memory _name) AccessStorageOwnableInitializable(_storage, _name){
        // record deployer to authorize the very first initialization only
        _S.setAddress(_initDeployerKey(), msg.sender);
    }

    function initLogic(address _logic) external override canInteract onlyInitDeployer notInitializedYet {
        // enforce UUPS compliant target and upgrade without data
        _upgradeToAndCallUUPS(_logic, new bytes(0), false);
        _S.setBool(_initDoneKey(), true);
        _S.setAddress(_initDeployerKey(), address(0));
    }

    function initLogicAndCall(address _logic, bytes memory _data) external override canInteract onlyInitDeployer notInitializedYet {
        // enforce UUPS compliant target and upgrade with data
        _upgradeToAndCallUUPS(_logic, _data, true);
        _S.setBool(_initDoneKey(), true);
        _S.setAddress(_initDeployerKey(), address(0));
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