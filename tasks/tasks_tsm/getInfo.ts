import { task } from "hardhat/config";
import { contractAt } from "../utils/contract-utils";

// TODO: pending to parametrize

task("getInfo", "getInfo")
    .setAction(async (taskArgs, hre) => {
        const tsm = "0x11E7f472537e98aFfFB145dFc47039a6b2aEDCeD"
        const seller = "0x2de047cA4211b28AE2484BC1b9741044C2028261"
        const token = "0xF20cE503BCd9721ea43Ddd0485C66fa675BD3FC5"
        const amount = "1000000000000000000000"

        const c = await contractAt(hre, "TokenSaleMarket", tsm);

        const accounts = await hre.ethers.getSigners();
        const buyerAcc = accounts[0];
        // console.log("estimate price")
        console.log("estimate price")
        let price = await c.functions.estimatePrice(
            token,
            seller,
            amount
        )
        console.log("estimated price", price[0].toString())

        console.log("calling buyToken for ")
        console.log("amount", amount, " | ether: ", hre.Web3.utils.fromWei(amount.toString()))
        console.log("seller", seller)
        console.log("token", token)
        console.log("price", price[0].toString(), " | ether: ", hre.Web3.utils.fromWei(price[0].toString()))
        console.log("calling buyToken estimate")
        let tx = await c.estimateGas.buyToken(
            amount,
            seller,
            token,
            { value: price[0].toString() }
        )
        console.log("estimated gas limit:", tx.toString())
        const gasPrice = 0.000000000028846269
        console.log("if avg gas price is")
    })