import { task } from "hardhat/config";
import { contractAt } from "../../utils/contract-utils";
import { getSigner } from "../../utils/simulation-utils";

/**
 * Set the V2 distribution config on a pool (owner only).
 *
 * Usage:
 *   npx hardhat setDistributionConfig <poolAddress> <owner> <minInterval> <claimDelay> <roundExpiry> --network basesepolia
 *   (all times in seconds; roundExpiry must be > 0)
 */
task("setDistributionConfig", "Set V2 distribution config (minInterval/claimDelay/roundExpiry)")
    .addPositionalParam("poolAddress", "the V2 pool proxy address")
    .addPositionalParam("owner", "the pool owner address (must be in .env keys)")
    .addPositionalParam("minInterval", "min seconds between distributions (0 = disabled)")
    .addPositionalParam("claimDelay", "seconds before claims open")
    .addPositionalParam("roundExpiry", "seconds a round stays claimable (> 0)")
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners();
        const owner = await getSigner(taskArgs.owner, accounts);

        const pool = await contractAt(hre, "DistributionPoolV2", taskArgs.poolAddress);
        const res = await pool.connect(owner).functions.setDistributionConfig(
            taskArgs.minInterval, taskArgs.claimDelay, taskArgs.roundExpiry
        );
        const tx = await res.wait();
        console.log("config set, hash:", tx.transactionHash);
    })
