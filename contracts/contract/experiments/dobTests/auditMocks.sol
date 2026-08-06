// SPDX-License-Identifier: BSL-1.0
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Snapshot.sol";

interface IPoolDistribute {
    function createDistribution(address token) external returns (uint256);
}

/**
 * Test doubles for the AUDIT 2026-08 suites. Not deployed anywhere.
 */

/// Answers the one call CrowdfundingV1's activation probe makes, so it passes
/// as a distribution pool without dragging in the whole proxy stack.
contract MockSplitter {
    address public participationToken;

    constructor(address _participationToken) {
        participationToken = _participationToken;
    }

    function getParticipationToken() external view returns (address) {
        return participationToken;
    }
}

/// A contract that is emphatically not a pool: it has code, but reverts on
/// anything the probe asks it.
contract NotASplitter {
    function hello() external pure returns (uint256) {
        return 1;
    }
}

/// Takes a 1 % cut on every transfer, so the recipient credits less than the
/// nominal amount — the shape that breaks naive escrow accounting.
contract FeeOnTransferToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("Fee On Transfer", "FOT") {
        _mint(msg.sender, initialSupply);
    }

    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        uint256 fee = amount / 100;
        super._transfer(from, to, amount - fee);
        if (fee > 0) {
            _burn(from, fee);
        }
    }
}

/// A participation token that re-enters the pool from inside `snapshot()`.
/// PoolMaster lets a pool be created around a caller-supplied participation
/// token (it only checks decimals and total supply), so this is a shape a real
/// attacker can deploy — it is what makes the ordering inside
/// `_doCreateDistribution` load-bearing rather than cosmetic.
contract ReentrantParticipationToken is ERC20Snapshot {
    address public pool;
    bool public armed;
    bool public reentered;
    bool public reentrantCallSucceeded;

    constructor(address[] memory holders, uint256[] memory amounts)
        ERC20("Evil Participation", "EVL")
    {
        for (uint256 i = 0; i < holders.length; i++) {
            _mint(holders[i], amounts[i]);
        }
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function setPool(address _pool) external {
        pool = _pool;
    }

    function arm() external {
        armed = true;
    }

    function snapshot() external returns (uint256) {
        if (armed && !reentered) {
            reentered = true;
            // Swallow the failure so the outer transaction still completes and
            // the test can inspect the resulting state.
            try IPoolDistribute(pool).createDistribution(address(0)) {
                reentrantCallSucceeded = true;
            } catch {
                reentrantCallSucceeded = false;
            }
        }
        return _snapshot();
    }
}

/// An ERC20 that reports failure instead of reverting — the "non-standard
/// token" case that a bare `transfer()` call swallows.
contract LyingToken {
    string public name = "Lying Token";
    string public symbol = "LIE";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 supply) {
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
    }

    /// Moves nothing, reverts nothing, returns false.
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    /// Credits a balance without going through `transfer`, so a test can put
    /// tokens inside a pool the way an airdrop or a mint would.
    function fund(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// A seller that lives in a contract with no `receive`/`fallback` — a vesting
/// contract, a treasury, any wallet that was never meant to take bare ETH.
/// `forward` lets it drive the market exactly as an EOA would.
contract AuditNonPayableSeller {
    function forward(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        require(ok, "FORWARD_FAILED");
        return ret;
    }
}

/// Force-feeds native currency to an address that refuses it, so tests can
/// recreate ETH that is already stranded on a deployed contract.
contract ForceSender {
    receive() external payable {}

    function destroy(address payable target) external {
        selfdestruct(target);
    }
}

/// Refuses plain native transfers, and burns gas doing it — a stand-in for a
/// smart-contract wallet that a 2300-gas `send` can never pay.
contract RejectsNative {
    receive() external payable {
        revert("NOPE");
    }
}

/// Accepts native currency but spends more than a `send` stipend allows, so a
/// `.send()`-based payout fails while a full-gas `call` succeeds.
contract GasHungryReceiver {
    uint256 public slot;
    uint256 public received;

    receive() external payable {
        // ~20k gas for a cold SSTORE: fine for `call`, impossible for `send`.
        slot = slot + 1;
        received += msg.value;
    }

    function forward(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        require(ok, "FORWARD_FAILED");
        return ret;
    }
}
