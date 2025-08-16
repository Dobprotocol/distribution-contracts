# Proxy initialization hardening plan

This document captures the analysis, design decisions, and step-by-step plan to harden proxy initialization in the logic/storage architecture while keeping backward compatibility.

## Context and goals

- Pattern: Logic + Proxy share Eternal Storage via a namespace; logic uses UUPS.
- Problem: Intermittent failures when calling `initialize()` due to it being run earlier than intended, or race windows in two-step flows.
- Goals: Remove race windows; restrict who can initialize; enforce UUPS; keep a single ownership model; avoid breaking existing deployments.

## Root-cause summary

- Some deploy flows do a two-step: `initLogic()` then later `initialize(...)`. Between steps, anyone can call the logic initializer on the proxy.
- `initLogicAndCall(...)` already exists and atomically upgrades and initializes.
- `LogicProxy` authorizes by `canInteract` (proxy has user role) but does not restrict the caller account; once the proxy has a user role, any account can call `initLogic*`.
- Implementations aren’t locked, allowing accidental direct initializes on the implementation address.

## Design principles

- Atomic initialization to remove race windows.
- Minimal, explicit authority for the very first init (separate from long-term owner).
- Enforce UUPS for safety.
- Keep the single shared owner in storage (do not split proxy vs logic ownership).

## Changes overview

1) Proxy-level init guard (one-time, deployer-only)
- Record `proxy.init.deployer` in storage during proxy construction.
- Add `onlyInitDeployer` + `notInitializedYet` modifiers on `initLogic` and `initLogicAndCall`.
- After init, set `proxy.init.done = true` and clear deployer.

2) Enforce UUPS in proxy
- Use `_upgradeToAndCallUUPS` instead of `_upgradeToAndCall` in `initLogic*`.

3) Lock implementations
- Call `_disableInitializers()` in constructors of logic contracts (e.g., `DistributionPool`, `PoolMaster`, `PoolMasterConfig`).

4) Deployment scripts use atomic init
- Replace two-step flows with a single `initLogicAndCall` that encodes the `initialize(...)` call data.

## Compatibility

- Storage layout unchanged.
- Owner remains a single value in Eternal Storage (as today).
- Existing proxies keep working; new proxies gain the init guard.

## Detailed steps

A) Update `contracts/contract/core/LogicProxy.sol`
- Add storage keys `proxy.init.deployer` (address) and `proxy.init.done` (bool).
- In constructor: set `proxy.init.deployer = msg.sender`.
- Add modifiers: `onlyInitDeployer`, `notInitializedYet`.
- Update `initLogic` and `initLogicAndCall` to:
  - require `onlyInitDeployer` and `notInitializedYet`.
  - call `_upgradeToAndCallUUPS`.
  - set `proxy.init.done = true` and clear deployer.

B) Lock implementations
- In each logic contract’s constructor, call `_disableInitializers()`.
  - `DistributionPool`
  - `PoolMaster`
  - `PoolMasterConfig`

C) Hardhat deploy flow updates
- Switch to atomic initialize in `tasks/.../deployPoolMaster.ts`:
  - For config proxy: `initLogicAndCall(logic, logic.interface.encodeFunctionData("initialize", [...]))`.
  - For deployer proxy: same pattern, with correct params.

## Risks and mitigations

- Risk: Scripts or tooling relying on two-step init break.
  - Mitigation: Update scripts to atomic flow. Keep `initLogic` for now but guarded; document deprecation.
- Risk: Incorrect `encodeFunctionData` usage.
  - Mitigation: Unit tests for deploy tasks or a small integration script to verify success on a local chain.
- Risk: Forgetting to grant proxy user/admin roles before init call.
  - Mitigation: Keep role grants in deploy scripts prior to `initLogicAndCall`.

## Testing policy (strict)

- No tests should be "cooked" (no faking success via stubs/mocks that skip real behavior). Tests must execute the real contracts and flows against a local Hardhat network.
- All existing tests must continue to pass unmodified unless they assert now-invalid behavior. Validate the full suite before and after changes.
- Add new tests where necessary to cover new guarantees:
  - Atomic init path succeeds and marks `proxy.init.done`.
  - Non-deployer cannot call `initLogic*` (reverts with `INIT_CALLER_NOT_DEPLOYER`).
  - Second init attempt reverts with `PROXY_ALREADY_INITIALIZED`.
  - UUPS enforcement: initializing to a non-UUPS logic reverts with `unsupported proxiableUUID`.
  - Implementations are locked: direct `initialize()` on the implementation address reverts due to `_disableInitializers()`.
  - Upgrade flow still works via `upgradeTo` and `upgradeToAndCall` through the proxy with `onlyProxy` and `onlyOwner`.

## Test cases

1) Proxy init: happy path
- Deploy Storage, grant user role to proxy.
- Deploy LogicProxy; call `initLogicAndCall` from deployer with encoded initializer.
- Expect: initialized, owner set, `proxy.init.done == true`.

2) Front-run protection
- After granting roles but before init, have attacker account attempt `initLogicAndCall`; expect revert `INIT_CALLER_NOT_DEPLOYER`.

3) Re-init prevention
- After successful init, any further `initLogic*` calls revert with `PROXY_ALREADY_INITIALIZED`.

4) UUPS safety
- Attempt to init to a contract lacking ERC1822 UUID; expect revert.

5) Locked implementation
- Call `initialize` on the logic implementation directly; expect revert from `_disableInitializers()`.

6) Backward compatibility
- Existing proxy (if any) still functions for reads/writes; new init guard applies only to new instances.

## Rollout plan

- Implement changes in a feature branch.
- Run full test suite locally.
- Update deploy scripts; dry-run on a local node.
- PR with this plan and diffs; request reviews.
- Tag a minor release noting the init hardening change and atomic init requirement for new deploys.

## Appendix: Notes on ownership

- Keep a single owner in the shared Eternal Storage for the proxy+logic pair.
- Use the proxy init-deployer only for the first initialization authority; do not split or duplicate ownership semantics.

## Addendum (2025-08-16): Correction to init hardening approach

Context: While implementing the plan, we discovered that writing to EternalStorage-backed state during constructors conflicts with our role-gated access pattern. Specifically, `canInteract` checks and `RemoteInitializable` state persistence rely on storage writes that require the proxy/logic address to already have the proper user role. Our deploy/tests grant roles only after deployment, creating a mismatch that can revert or brick contracts when constructors attempt storage writes.

What changed vs. the plan:
- LogicProxy deployer-only init guard removed: The original plan proposed persisting `proxy.init.deployer` in the proxy constructor and enforcing `onlyInitDeployer` on `initLogic*`. Persisting this in storage during construction caused role-gating conflicts. We removed the deployer-only requirement and retained `canInteract` + `notInitializedYet` checks on `initLogic` and `initLogicAndCall`.
- No `_disableInitializers()` in logic constructors: The plan recommended locking implementations via `_disableInitializers()` in constructors. In our setup (`AccessStorageOwnableInitializable`/`RemoteInitializable`), initializer flags are stored in EternalStorage, so calling `_disableInitializers()` in constructors also performs storage writes before roles are granted. We avoided this to maintain deploy-time compatibility.

Adopted approach:
- Avoid any constructor-time writes to EternalStorage across `LogicProxy.sol`, `DistributionPool.sol`, `PoolMaster.sol`, and `PoolMasterConfig.sol`.
- Keep `initLogic`/`initLogicAndCall` guarded by `canInteract` and a one-time `notInitializedYet` flag, without the deployer-only restriction.
- Prefer atomic initialization via `initLogicAndCall` in deployment flows to eliminate race windows. Ensure the proxy is granted USER_ROLE immediately before calling `initLogicAndCall` in the same scripted sequence.

Security considerations and mitigations:
- Risk: Once the proxy has USER_ROLE, any account can call `initLogic*` until the first successful init. Mitigations:
  - Grant USER_ROLE to the proxy just-in-time and call `initLogicAndCall` atomically within the deploy script.
  - Optionally, perform the role grant and init from a controlled deployer/admin account and immediately proceed to complete initialization in the same transaction/script step.
  - For further hardening without constructor storage writes, consider a factory pattern that grants role and calls `initLogicAndCall` within one transaction, or introduce an initialization secret/salt validated by the logic’s `initialize` (passed via calldata), coordinated through the deploy script.
- UUPS enforcement remains recommended; use `_upgradeToAndCallUUPS` where feasible (subject to the same constructor write constraints) and cover with tests.

Test status:
- With these corrections, compilation succeeds and the v2 suite passes (all tests green). Behavior aligns with EternalStorage role gating and our deployment timing assumptions.

Documentation and scripts:
- Update deploy docs and scripts to use the atomic `initLogicAndCall` path and to grant roles immediately before initialization, minimizing exposure.

Rationale summary:
- EternalStorage + role-gated access means constructors must not write to storage because roles are not yet granted at deploy time. Therefore, deployer-only init tracking in constructor and `_disableInitializers()` in constructors are incompatible with this architecture. The corrected approach preserves safety through atomic init and one-time guards without constructor-time storage writes.
