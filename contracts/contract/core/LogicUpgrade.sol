// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "../../interface/LogicProxyInterface.sol";
import "../../interface/StorageInterface.sol";
import "../storage/AccessStorageOwnableInitializable.sol";
import "@openzeppelin/contracts/proxy/Proxy.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import "../remote/RemoteInitializable.sol";
import "@openzeppelin/contracts/interfaces/draft-IERC1822.sol";

/**
 * @title LogicProxiable
 * @author Francisco Muñoz
 * @notice
 * 
 * contract inspired by 
 *      - openzeppelin/contracts/proxy/ERC1967/ERC1967Ugrade.sol
 *      - openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol
 */
abstract contract LogicUpgrade {
    /**
     * @dev Emitted when the implementation is upgraded.
     */
    event Upgraded(address indexed implementation);
    

    /**
     * @dev Perform implementation upgrade with security checks for UUPS proxies, and additional setup call.
     *
     * Emits an {Upgraded} event.
     */
    function _upgradeToAndCallUUPS(
        address newImplementation,
        bytes memory data,
        bool forceCall
    ) internal {
        // we wont allow upgraded to implementations that are not proxiable
        // so we replace the try-catch used by openzeppelin and directly throws

        // try IERC1822Proxiable(newImplementation).proxiableUUID() returns (bytes32 slot) {
        //     require(slot == _IMPLEMENTATION_SLOT, "ERC1967Upgrade: unsupported proxiableUUID");
        // } catch {
        //     revert("ERC1967Upgrade: new implementation is not UUPS");
        // }
        require(
            IERC1822Proxiable(newImplementation).proxiableUUID() == _getImplementationSlot(), 
            "ERC1967Upgrade: unsupported proxiableUUID");

        _upgradeToAndCall(newImplementation, data, forceCall);
    }

    /**
     * @dev Perform implementation upgrade with additional setup call.
     *
     * Emits an {Upgraded} event.
     */
    function _upgradeToAndCall(
        address newImplementation,
        bytes memory data,
        bool forceCall
    ) internal {
        _upgradeTo(newImplementation);
        if (data.length > 0 || forceCall) {
            Address.functionDelegateCall(newImplementation, data);
        }
    }

    /**
     * @dev Perform implementation upgrade
     *
     * Emits an {Upgraded} event.
     */
    function _upgradeTo(address newImplementation) internal {
        _setImplementation(newImplementation);
        emit Upgraded(newImplementation);
    }

    function _getImplementationSlot() internal pure returns(bytes32){
        return keccak256(abi.encodePacked("DOB", "erc1822", "erc1967", "proxiable", "UUPS"));
    }
    function _setImplementation(address newImplementation) internal virtual;
    function getImplementation() public view virtual returns(address);

}