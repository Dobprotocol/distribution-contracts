import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import { contractAt, upgradeContract } from "./subtasks/utils/contract-utils";
import "./subtasks/upgradeContract";
import { text } from "stream/consumers";

task("tsmSetSale", "tsmSetSale")
    .addPositionalParam("tsmAddress", "the address for the TSM used")
    .addPositionalParam("sellerPriv", "private key of the seller")
    .addPositionalParam("tokenAddress", "address of the token to sale")
    .addPositionalParam("amount", "the total amount of tokens to allow for the sale, in ether")
    .addPositionalParam("unitPrice", "the unitary price (given by minDiv) for the sale, in ether")
    .addOptionalParam("minDiv", "the minimum unitary division for the sale, in ether", "1")
    .addOptionalParam("showTxRes", "wether to show or not the tx results", "false")
    .setAction(async (taskArgs, hre) => {

        const amount = hre.ethers.utils.parseEther(taskArgs.amount)
        const price = hre.ethers.utils.parseEther(taskArgs.unitPrice)
        const minDiv = hre.ethers.utils.parseEther(taskArgs.minDiv)
        const provider = hre.ethers.provider
        const signer = new hre.ethers.Wallet(taskArgs.sellerPriv, provider)
        const tsm = await contractAt(hre, "TokenSaleMarket", taskArgs.tsmAddress);
        const token = await contractAt(hre, "ERC20", taskArgs.tokenAddress);
        const showTxRes = taskArgs.showTxRes === "true"
        console.log("::::: saleProperties config :::::")
        console.log("-> seller:", signer.address)
        console.log("-> tsm address:", tsm.address)
        console.log("-> token address:", token.address)
        console.log("-> amount (wei):", amount.toString())
        console.log("-> unitPrice (wei):", price.toString())
        console.log("-> minDiv (wei):", minDiv.toString())
        console.log("-> seller balance (ether):", hre.ethers.utils.formatEther(await provider.getBalance(signer.address)))
        console.log("::::::::::::::::::::::::::::::::::")

        console.log("1. calling TSM.setSaleProperties()")
        // npx hardhat --network base tsmSetSale 0x11E7f472537e98aFfFB145dFc47039a6b2aEDCeD 399bfe162112819a61079936b7a4908d05f68c748244058ebc189bed16a9611b 0x0 1 0.0025
        // npx hardhat --network alfajores tsmSetSale 0x29076a1b1Dc5d842152D74569a8d02CBb01170E3 399bfe162112819a61079936b7a4908d05f68c748244058ebc189bed16a9611b 0x4cc588E5b80D55440C1e5f8A4d85d6CFd568997E 1 0.0025
        let tx = await tsm.connect(signer).functions.setSaleProperties(
            token.address,
            price,
            minDiv
        )
        if (showTxRes){
            console.log("-> tx:", tx)
        }
        let data = await tx.wait()
        if (showTxRes){
            console.log("-> tx res data:", data)
        }
        console.log("2. calling ERC20.approve()")
        tx = await token.connect(signer).functions.approve(tsm.address, amount)
        if (showTxRes){
            console.log("-> tx:", tx)
        }
        data = await tx.wait()
        if (showTxRes){
            console.log("-> tx res data:", data)
        }
        console.log(":::: check that everting is right :::::")
        console.log("1. check sale properties")
        let properties = await tsm.connect(signer).functions.getSaleProperties(token.address)
        console.log("-> sale properties are:", properties)
        console.log("2. check allowance")
        let allowance = await token.functions.allowance(signer.address, tsm.address)
        console.log("-> allowance is:", allowance)
    })