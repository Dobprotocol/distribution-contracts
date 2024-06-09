// SPDX-License-Identifier: BSL-1.0
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
// Importing OpenZeppelin's SafeMath Implementation
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../../interface/dob/ParticipationTokenInterface.sol";

contract ParticipationToken is ERC20Pausable, Initializable, ParticipationTokenInterface {
    using SafeMath for uint256;

    bool private _lockToken;

    constructor(
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) {
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
}
