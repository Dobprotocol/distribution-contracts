import { subtask, task } from "hardhat/config";
import { deployerContract, contractAt } from "../utils/contract-utils";
import { getSigner } from "../utils/simulation-utils";
import { constants } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

task("transfer", "task to transfer currency between holder address and toAddress")
    .addPositionalParam("ownerAddress", "The address of the owner of the currency. Must match the private key from .env file")
    .addPositionalParam("toAddress", "the address who will receive the currency")
    .addPositionalParam("amount", "the amount to transfer, in eth")
    .setAction(async (taskArgs, hre) => {

        const accounts = await hre.ethers.getSigners();
        const signer: SignerWithAddress = getSigner(taskArgs.ownerAddress, accounts)
        const amount = hre.ethers.utils.parseEther(taskArgs.amount).toString()

        const nonce = await signer.getTransactionCount()
        console.log("nonce", nonce)
        const tx = await signer.sendTransaction({
            to: taskArgs.toAddress,
            value: amount,
            nonce: nonce + 1
        })
        console.log("currency transfer, tx", tx)
    })