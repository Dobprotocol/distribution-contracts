import { subtask, task } from "hardhat/config";
import { deployerContract, contractAt } from "../utils/contract-utils";
import { getSigner } from "../utils/simulation-utils";

task("transferToken", "task to transfer tokens between holder address and toAddress")
    .addPositionalParam("tokenAddress", "the address of the token")
    .addPositionalParam("ownerAddress", "The address of the owner of the token. Must match the private key from .env file")
    .addPositionalParam("toAddress", "the address who will receive the tokens")
    .addPositionalParam("amount", "the amount to transfer, in eth")
    .setAction(async (taskArgs, hre) => {

        const accounts = await hre.ethers.getSigners();
        const signer = getSigner(taskArgs.ownerAddress, accounts)
        const amount = hre.ethers.utils.parseEther(taskArgs.amount).toString()

        let token = await contractAt(hre, "ERC20", taskArgs.tokenAddress)

        let tx = await token.connect(signer).transfer(taskArgs.toAddress, amount)
        let data = await tx.wait()
        console.log("tokens transfer, tx", data)
    })