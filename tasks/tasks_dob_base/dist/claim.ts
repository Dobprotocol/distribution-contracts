import { task } from "hardhat/config";
import { contractAt } from "../../utils/contract-utils";
import { getSigner } from "../../utils/simulation-utils";

/**
 * Claim a shareholder's pro-rata share of a V2 distribution round. Claims are
 * permissionless: any signer may trigger them; funds always go to
 * `shareholder`.
 *
 * Usage:
 *   npx hardhat claim <poolAddress> <caller> <shareholder> <roundId> [--token <addr>] --network basesepolia
 */
task("claim", "Claim from a V2 distribution round")
    .addPositionalParam("poolAddress", "the V2 pool proxy address")
    .addPositionalParam("caller", "the signer that sends the tx (must be in .env keys)")
    .addPositionalParam("shareholder", "the shareholder receiving the funds")
    .addPositionalParam("roundId", "the distribution round id")
    .addOptionalParam("token", "reward token address (0x0 = native)", "0x0000000000000000000000000000000000000000")
    .setAction(async (taskArgs, hre) => {
        const accounts = await hre.ethers.getSigners();
        const caller = await getSigner(taskArgs.caller, accounts);

        const pool = await contractAt(hre, "DistributionPoolV2", taskArgs.poolAddress);

        const claimable = (await pool.functions.getClaimable(
            taskArgs.shareholder, taskArgs.token, taskArgs.roundId
        ))[0];
        console.log("claimable for", taskArgs.shareholder, "in round", taskArgs.roundId, "=", claimable.toString());

        const res = await pool.connect(caller).functions.claim(
            taskArgs.shareholder, taskArgs.token, taskArgs.roundId
        );
        const tx = await res.wait();
        console.log("Transaction complete, hash:", tx.transactionHash);
    })
