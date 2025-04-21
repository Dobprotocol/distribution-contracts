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