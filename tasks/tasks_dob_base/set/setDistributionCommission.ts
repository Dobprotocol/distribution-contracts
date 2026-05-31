import { task } from "hardhat/config";
import { contractAt } from "../../utils/contract-utils";
import { getSigner } from "../../utils/simulation-utils";

/**
 * Update the V2 distribution commission (basis points). Only callable by the
 * current commission recipient (the pool's treasury address), not the owner.
 *
 * Usage:
 *   npx hardhat setDistributionCommission <poolAddress> <treasury> <bps> --network basesepolia
 *   (bps: 50 = 0.5%, max 5000 = 50%)
 */
task("setDistributionCommission", "Set V2 distribution commission (treasury only)")
    .addPositionalParam("poolAddress", "the V2 pool proxy address")
    .addPositionalParam("treasury", "the commission recipient / treasury address (must be in .env keys)")
    .addPositionalParam("bps", "commission in basis points (50 = 0.5%)")
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners();
        const treasury = await getSigner(taskArgs.treasury, accounts);

        const pool = await contractAt(hre, "DistributionPoolV2", taskArgs.poolAddress);
        const res = await pool.connect(treasury).functions.setDistributionCommission(taskArgs.bps);
        const tx = await res.wait();
        console.log("commission set, hash:", tx.transactionHash);
    })
