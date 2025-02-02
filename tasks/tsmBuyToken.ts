import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import { contractAt, upgradeContract } from "./subtasks/utils/contract-utils";
import "./subtasks/upgradeContract";
import { text } from "stream/consumers";

task("tsmBuyToken", "tsmBuyToken")
    .addPositionalParam("tsmAddress", "the address for the TSM used")
    .addPositionalParam("buyerPriv", "private key of the buyer")
    .addPositionalParam("sellerAddress", "address of the seller of the token")
    .addPositionalParam("tokenAddress", "address of the token to sale")
    .addPositionalParam("amount", "the total amount of tokens to buy, in ether")
    .addPositionalParam("payPrice", "the total price to pay for the tokens, in ether. Must be exact match")
    .addOptionalParam("showTxRes", "wether to show or not the tx results", "false")
    .setAction(async (taskArgs, hre) => {

        const amount = hre.ethers.utils.parseEther(taskArgs.amount)
        const price = hre.ethers.utils.parseEther(taskArgs.payPrice)
        const provider = hre.ethers.provider
        const signer = new hre.ethers.Wallet(taskArgs.buyerPriv, provider)
        const seller = taskArgs.sellerAddress
        const tsm = await contractAt(hre, "TokenSaleMarket", taskArgs.tsmAddress);
        const token = await contractAt(hre, "ERC20", taskArgs.tokenAddress);
        const showTxRes = taskArgs.showTxRes === "true"
        console.log("::::: saleProperties config :::::")
        console.log("-> buyer:", signer.address)
        console.log("-> seller:", seller)
        console.log("-> tsm address:", tsm.address)
        console.log("-> token address:", token.address)
        console.log("-> amount (wei):", amount.toString())
        console.log("-> payPrice (wei):", price.toString())
        console.log("-> buyer currency balance (ether):", hre.ethers.utils.formatEther(await provider.getBalance(signer.address)))
        console.log("-> buyer token balance (ether):", hre.ethers.utils.formatEther((await token.functions.balanceOf(signer.address))[0]))
        console.log("::::::::::::::::::::::::::::::::::")

        console.log("1. calling TSM.buyToken()")
        // npx hardhat --network base tsmBuyToken 0x11E7f472537e98aFfFB145dFc47039a6b2aEDCeD 399bfe162112819a61079936b7a4908d05f68c748244058ebc189bed16a9611b 0x2de047cA4211b28AE2484BC1b9741044C2028261 1 0.0025
        let tx = await tsm.connect(signer).functions.buyToken(
            amount.toString(),
            seller,
            token.address,
            {value: price.toString()}
        )
        if (showTxRes){
            console.log("-> tx:", tx)
        }
        let data = await tx.wait()
        if (showTxRes){
            console.log("-> tx res data:", data)
        }
        console.log(":::: check that everting is right :::::")
        console.log("1. check balance for buyer")
        console.log("-> buyer currency balance (ether):", hre.ethers.utils.formatEther(await provider.getBalance(signer.address)))
        console.log("-> buyer token balance (ether):", hre.ethers.utils.formatEther((await token.functions.balanceOf(signer.address))[0]))

    })