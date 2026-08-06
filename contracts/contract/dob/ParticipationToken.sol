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

    /// Whoever deployed this token — PoolMaster for every platform pool.
    address public immutable deployer;

    /// Pools allowed to take balance snapshots (AUDIT 2026-08 / B-5).
    mapping(address => bool) public snapshotter;

    error NotDeployer();
    error NotAuthorizedToSnapshot();

    constructor(
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) {
        deployer = msg.sender;
    }

    /**
     * AUDIT 2026-08 (B-5). `snapshot()` used to be callable by anyone, on the
     * reasoning that an extra snapshot is harmless. It is not free: ERC20Snapshot
     * writes a fresh checkpoint for an account the first time it moves tokens
     * after each new snapshot id, so a stranger spamming snapshots makes every
     * holder pay an extra SSTORE on their next transfer and grows this
     * contract's storage without bound. Only the pools that actually distribute
     * against this token may create one now.
     */
    function authorizeSnapshotter(address pool) external {
        if (msg.sender != deployer) {
            revert NotDeployer();
        }
        snapshotter[pool] = true;
    }

    /**
     * Create a balance snapshot and return its id. Used by DistributionPoolV2
     * to record shareholders' balances at distribution time, so claims are
     * computed from the snapshot (not the live balance) — preventing
     * re-claiming a round by transferring shares to fresh addresses.
     */
    function snapshot() public returns (uint256) {
        if (msg.sender != deployer && !snapshotter[msg.sender]) {
            revert NotAuthorizedToSnapshot();
        }
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

    /**
     * AUDIT 2026-08 (B-6). The mint entry points were `initializer public` and
     * nothing else, so the whole cap table of a token that was deployed but not
     * yet minted belonged to whoever called first. PoolMaster deploys and mints
     * in one transaction, which is why this was never exploitable in practice —
     * but it holds only by accident of call ordering, and any future path that
     * splits the two hands the pool away. The deployer check makes it structural.
     */
    modifier onlyDeployer() {
        if (msg.sender != deployer) {
            revert NotDeployer();
        }
        _;
    }

    function mint_participants(
        uint256 initialSupply,
        address[] memory usersAddress,
        uint256[] memory shares,
        bool pauseToken
    ) initializer onlyDeployer public override {
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
    ) initializer onlyDeployer public override {
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
