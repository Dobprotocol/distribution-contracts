import { ethers, upgrades } from "hardhat"
import { Contract, Signer } from "ethers"
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export function getGas(tx, res) {
    let gasUsed = res.gasUsed;
    let gasPrice = tx.gasPrice;
    let gasCost = gasUsed.mul(gasPrice);

    return gasCost;
}

export function findEvent(res, eventName: string) {
    let event;
    for (event of res.events){
        if (event.event == eventName){
            break;
        }
    }
    return event
}

export async function getBalances(
    accounts: SignerWithAddress[], tokens: Contract[] = [], names: string[] = []
) : Promise<Object>{
    var userInfo: object = {};
        for (let i = 0; i < accounts.length; i++) {
            await ethers.provider.getBalance(accounts[i].address)
                .then((res: BigNumber) => {
                    userInfo[accounts[i].address] = {eth: res};
                });
            for (let j = 0; j < tokens.length; j++){
                // console.log("balance", names[j], await tokens[j].balanceOf(accounts[i].address))
                userInfo[accounts[i].address][names[j]] = await tokens[j].balanceOf(accounts[i].address)
            }
        }
    return userInfo;
}