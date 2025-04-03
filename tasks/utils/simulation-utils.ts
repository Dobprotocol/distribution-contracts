import { deployPoolTreshory, deployPool } from "./deploy-utils";
import { getEpochRangeDate, contractAt} from "./contract-utils";

export async function simulationTreshory(hre, poolMaster, participantsId: number[], shares: number[], creatorAddressId: number){
    const accounts = await hre.ethers.getSigners();
    let treshoryParticipants: string[] = []
    let treshoryShares: number[] = []
    for (let participantIdx of participantsId){
        treshoryParticipants.push(accounts[participantIdx].address)
    }
    for (let share of shares){
        treshoryShares.push(share)
    }
    console.log("threshory participants", treshoryParticipants);
    console.log("treshory shares:", treshoryShares)
    await deployPoolTreshory(hre, poolMaster, accounts[creatorAddressId],
        treshoryParticipants, treshoryShares)
        .catch((err) => console.error("pdt creation: ", err));
    return treshoryParticipants;
}

// hre: Hardhat Runtime Environment (HRE)
// poolNaster: Contract
// creatorAddressId: idx of the account used for creating stuff
// data: dictionary with the config data
//  data keys = {participantsId, shares, dates.nIterations, dates.timeDelta}
export async function simulationPools(
    hre, poolMaster, expectedPoolsNumber, data, tag: string = "Token"
){
    const accounts = await hre.ethers.getSigners();
    let participantsAddress: string[] = []
    let participantsShare: number[] = []
    for (let participantIdx of data.participantsId){
        participantsAddress.push(accounts[participantIdx].address)
    }
    for (let share of data.shares){
        participantsShare.push(share)
    }

    let distributeDatesStr = getEpochRangeDate(Math.floor(Date.now()/1000), 
                data.dates.nIterations, data.dates.timeDelta);
    // console.log("participant ids:", data.participantsId);
    // console.log("creator address", accounts[data.participantsId[0]]);
    // console.log("participant address:", participantsAddress)            
    let poolsAddress = await deployPool(
        hre, 
        poolMaster, 
        accounts[data.participantsId[0]], 
        expectedPoolsNumber,
        participantsAddress, participantsShare,
        distributeDatesStr, 
        data.name + tag);
    let poolData = {
        "poolAddress": poolsAddress[poolsAddress.length - 1],
        "participantAddress": participantsAddress,
        "poolCreatorAddress": accounts[data.participantsId[0]].address
    }
    console.log("--> pool address:", poolsAddress[poolsAddress.length - 1])
    for (let addr of participantsAddress){
        console.log("---> Participant Address:", addr)
    }
    return poolData;
}

// hre: Hardhat Runtime Environment (HRE)
export async function depositPrePay(hre, poolAddress: string, contractName: string = "TokenPool", etherAmount: string = "1") {
    const accounts = await hre.ethers.getSigners();
    const pool = await contractAt(hre, contractName, poolAddress);

    let amount = hre.ethers.utils.parseEther(etherAmount);
    console.log("ETHERS TO DEPOSIT: ", amount);
    console.log("wait 5 sec");
    await new Promise(r => setTimeout(r, 5000));
    await pool.connect(accounts[0]).functions.prePay({ value: amount.toString() })
    .then(async (res) => {
        console.log("pre-pay (ethers) :",
            hre.ethers.utils.formatEther(res.value));
    });

}

// _address: string address to find signer
// accounts: list of signers SignerWithAddress[]
// return: found signer SignerWithAddress
export function getSigner(
    _address, accounts
) {
    for (let acc of accounts) {
        if (acc.address == _address){
            return acc;
        }
    }
    throw "failed to get signer"
}