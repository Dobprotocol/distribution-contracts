// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

enum KeyPrefix {
    creator,
    operational,
    coef,
    intercept,
    commission,
    isPublic,
    owner,
    treasury,
    participationToken,
    newOwner,
    nDistributions,
    distributionInterval,
    firstDistributionDate,
    prevDistributionDate,
    index,
    isFirstDistribution,
    prepay,
    gas,
    userCurrent,
    distribution,
    setOperational,
    setRegressionCoef,
    setRegressionIntercept,
    externalTokenExists,
    poolName,
    logicVersion,
    proxyName,
    tokenSaleMarketCommission,
    tsmAddressPool,
    tsmAddressSeller,
    tsmSalePrice,
    tsmMinDivision,
    tsmApplyCommission,
    tsmLockedSale,
    baseCommissionPool,
    baseCommissionTSM,
    gasPrice,
    pmConfig,
    goalAmount,
    poolType,
    sharesLimit,
    // ----------------------------------------------------------------
    // V2 lazy pull-based distribution (soro-splitter-v2 port).
    // APPEND-ONLY: these produce brand-new uint8 prefix values that have
    // never been written, so they cannot collide with any existing pool
    // state in EternalStorage. NEVER reorder or insert above this line.
    // ----------------------------------------------------------------
    roundCount,          // per token: number of distribution rounds created
    roundTotalAmount,    // per (token, roundId): amount to distribute (post-commission)
    roundSupplySnapshot, // per (token, roundId): participation token totalSupply at creation
    roundCreatedAt,      // per (token, roundId)
    roundClaimableFrom,  // per (token, roundId): createdAt + claimDelay
    roundExpiresAt,      // per (token, roundId): createdAt + roundExpiry
    roundTotalClaimed,   // per (token, roundId): cumulative claimed
    roundReclaimed,      // per (token, roundId): bool, admin reclaimed remainder
    roundClaimed,        // per (token, roundId, user): bool, double-claim guard
    lastRoundCreatedAt,  // per token: timestamp of last round, for time-gating
    distCommissionBps,   // per pool: distribution commission in basis points
    distCommissionSet,   // per pool: bool, whether commission was explicitly set
    minIntervalSeconds,  // per pool: min time between distributions (time-gating)
    claimDelaySeconds,   // per pool: delay before claims open
    roundExpirySeconds,  // per pool: how long a round stays claimable
    distConfigSet,       // per pool: bool, whether distribution config was set
    schedEnabled,        // per token: bool, auto-schedule enabled
    schedFirstTime,      // per token: first scheduled distribution timestamp
    schedInterval,       // per token: seconds between scheduled distributions
    schedTotalCount,     // per token: total scheduled distributions (0 = unlimited)
    schedExecuted,       // per token: scheduled distributions already fired
    roundSnapshotId,     // per (token, roundId): participation-token snapshot id at round creation
    publicDistribution   // per pool: bool, owner opt-in to permissionless createDistribution (AUDIT 2026-08 / B-1)
}