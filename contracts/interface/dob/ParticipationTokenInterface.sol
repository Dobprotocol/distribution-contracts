// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

interface ParticipationTokenInterface {

    function mint_participants(
        uint256 initialSupply, 
        address[] memory usersAddress, 
        uint256[] memory shares,
        bool pauseToken
    ) external;

    function mint_single_owner(
        uint256 initialSupply,
        address singleParticipant,
        bool pauseToken
    ) external;
}