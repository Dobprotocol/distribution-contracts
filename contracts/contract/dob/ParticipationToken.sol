// SPDX-License-Identifier: BSL-1.0
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Snapshot.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
// Importing OpenZeppelin's SafeMath Implementation
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../../interface/dob/ParticipationTokenInterface.sol";

contract ParticipationToken is ERC20Pausable, ERC20Snapshot, Initializable, ParticipationTokenInterface {
    using SafeMath for uint256;

    bool private _lockToken;

    constructor(
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) {
    }

    /**
     * Create a balance snapshot and return its id. Used by DistributionPoolV2
     * to record shareholders' balances at distribution time, so claims are
     * computed from the snapshot (not the live balance) — preventing
     * re-claiming a round by transferring shares to fresh addresses.
     * Permissionless: creating a snapshot is harmless; the caller records the
     * returned id for its own use.
     */
    function snapshot() public returns (uint256) {
        return _snapshot();
    }

    // resolve multiple-inheritance of _beforeTokenTransfer
    // (ERC20Pausable: paused-check; ERC20Snapshot: balance-history update)
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20Pausable, ERC20Snapshot) {
        super._beforeTokenTransfer(from, to, amount);
    }

    function mint_participants(
        uint256 initialSupply, 
        address[] memory usersAddress, 
        uint256[] memory shares,
        bool pauseToken
    ) initializer public override {
        require(usersAddress.length == shares.length, "users does not match shares");
        require(usersAddress.length > 0, "empty array not allowed");
        if (usersAddress.length > 1){
            _sendParticipation(initialSupply, usersAddress, shares);
        } else {
            _mint(usersAddress[0], initialSupply);
        }
        if (pauseToken){
            _pause();
        }
    }

    function mint_single_owner(
        uint256 initialSupply,
        address singleParticipant,
        bool pauseToken
    ) initializer public override {
        _mint(singleParticipant, initialSupply);
        if (pauseToken){
            _pause();
        }
    }


    function _sendParticipation(
        uint256 initialSupply,
        address[] memory usersAddress,
        uint256[] memory shares
    ) onlyInitializing internal {
        require(usersAddress.length == shares.length, "Input inconsitency");
        uint256 _totalShare = 0;
        for (uint i = 0; i < shares.length; i++) {
            _totalShare += shares[i];
        }
        require(
            initialSupply.mod(_totalShare) == 0, 
            "Total supply is not divisible by shares sum!");

        uint256 _amount;
        for (uint i = 0; i < usersAddress.length; i++) {
            _amount = shares[i].mul(initialSupply).div(_totalShare);
            _mint(usersAddress[i], _amount);
        }
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }
}
