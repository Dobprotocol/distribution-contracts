import { task } from "hardhat/config";
import { contractAt } from "../../utils/contract-utils";
import { getSigner } from "../../utils/simulation-utils";

/**
 * Create a new distribution round on a V2 pool (O(1) snapshot). The pool must
 * already hold the reward token (native or ERC20 transferred in / deposited).
 *
 * Usage:
 *   npx hardhat createDistribution <poolAddress> <ownerAddress> [--token <addr>] --network basesepolia
 *   (token defaults to the zero address = native currency)
 */
task("createDistribution", "Create a V2 distribution round")
    .addPositionalParam("poolAddress", "the V2 pool proxy address")
    .addPositionalParam("owner", "the pool owner/operational address (must be in .env keys)")
    .addOptionalParam("token", "reward token address (0x0 = native)", "0x0000000000000000000000000000000000000000")
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners();
        const owner = await getSigner(taskArgs.owner, accounts);

        const pool = await contractAt(hre, "DistributionPoolV2", taskArgs.poolAddress);
        console.log("creating distribution on pool", pool.address, "token", taskArgs.token);

        const res = await pool.connect(owner).functions.createDistribution(taskArgs.token);
        const tx = await res.wait();

        let roundId = "?";
        for (const ev of tx.events || []) {
            if (ev.event === "DistributionRoundCreated") {
                roundId = ev.args.roundId.toString();
                console.log(
                    `round ${roundId} created — totalAmount ${ev.args.totalAmount.toString()},`,
                    `supply ${ev.args.totalSupplySnapshot.toString()}, commission ${ev.args.commission.toString()}`
                );
            }
        }
        console.log("Transaction complete, hash:", tx.transactionHash, "roundId:", roundId);
    })
