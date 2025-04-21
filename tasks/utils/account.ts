

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