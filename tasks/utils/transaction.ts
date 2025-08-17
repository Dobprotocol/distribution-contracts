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

// Helper function to retry blockchain transactions
export async function retryTransaction(
    txFunction: () => Promise<any>,
    description: string,
    retries: number = 3,
    delayMs: number = 3000,
    backoffFactor: number = 2
): Promise<any> {
    const wait = (ms: number) => new Promise(res => setTimeout(res, ms));
    
    let lastError: any;
    let attempt = 0;
    let currentDelay = delayMs;
    
    while (attempt <= retries) {
        try {
            console.log(`[${description}] Attempting transaction (attempt ${attempt + 1}/${retries + 1})`);
            const txData = await txFunction();
            const resData = await txData.wait();
            if (attempt > 0) {
                console.log(`[${description}] Transaction succeeded on attempt ${attempt + 1}`);
            }
            return { txData, resData };
        } catch (err) {
            lastError = err;
            console.warn(`[${description}] Attempt ${attempt + 1} failed:`, err?.message || err);
            attempt++;
            if (attempt > retries) break;
            if (currentDelay > 0) {
                console.log(`[${description}] Retrying in ${currentDelay} ms`);
                await wait(currentDelay);
                currentDelay = Math.floor(currentDelay * backoffFactor);
            }
        }
    }
    console.error(`[${description}] All ${retries + 1} attempts failed`);
    throw lastError;
}