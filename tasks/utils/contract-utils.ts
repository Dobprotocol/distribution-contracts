
// return: Promise<Contract>
// hre: Hardhat Runtime Environment (HRE)
// signer: Signer
export async function deployerContract(
    hre,
    nameContract: string,
    libraries = {},
    upgradable: boolean = false,
    upgradeOptions = {},
    deployArgs: any[] = [],
    signer?,
    retryConfig: { retries?: number, delayMs?: number, backoffFactor?: number } = {}
) {
    // Retry configuration (defaults chosen to keep quick feedback yet resilient)
    let { retries = 3, delayMs = 3000, backoffFactor = 2 } = retryConfig;
    // Guard against negative values
    retries = Math.max(0, retries);
    delayMs = Math.max(0, delayMs);
    backoffFactor = backoffFactor <= 0 ? 2 : backoffFactor;

    // Helper wait
    const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

    let lastError: any;
    let attempt = 0;
    let currentDelay = delayMs;
    while (attempt <= retries) {
        try {
            let factoryOptions: object = signer === undefined ? { libraries } : { libraries, signer };
            const ContracT = await hre.ethers.getContractFactory(nameContract, factoryOptions);
            let contract;
            if (upgradable) {
                // NOTE: upgradeOptions is passed as args or options depending on project usage; keeping existing behavior.
                contract = await hre.upgrades.deployProxy(ContracT, upgradeOptions);
            } else {
                contract = await ContracT.deploy(...deployArgs);
            }
            await contract.deployed();
            if (attempt > 0) {
                console.log(`[deployerContract] Succeeded deploying ${nameContract} on attempt ${attempt + 1}`);
            }
            return contract;
        } catch (err) {
            lastError = err;
            console.warn(`[deployerContract] Attempt ${attempt + 1} to deploy ${nameContract} failed:`, err?.message || err);
            attempt++;
            if (attempt > retries) break;
            if (currentDelay > 0) {
                console.log(`[deployerContract] Retrying in ${currentDelay} ms (attempt ${attempt + 1} of ${retries + 1})`);
                await wait(currentDelay);
                currentDelay = Math.floor(currentDelay * backoffFactor);
            }
        }
    }
    console.error(`[deployerContract] All ${retries + 1} attempts failed for ${nameContract}`);
    throw lastError;
}


// return: Promise<BigNumber>
// hre: Hardhat Runtime Environment (HRE)
// signer: Signer
export async function estimateContractGas(hre, nameContract: string, libraries = {},
    upgradable: boolean = false, upgradeOptions = {}, deployArgs: any[] = [],
    signer) {
    var factoryOptions: object = {};
    if (signer === undefined) {
        factoryOptions = { libraries: libraries }
    } else {
        factoryOptions = { libraries: libraries, signer: signer };
    }

    const ContracT = await hre.ethers.getContractFactory(
        nameContract, factoryOptions);
    
    let gasEstimate;
    if (upgradable) {
        // For upgradable contract deployment, simulate a proxy deploy and estimate gas
        gasEstimate = await hre.upgrades.estimateGas.deployProxy(ContracT, upgradeOptions);
    } else {
        // For normal contracts, estimate the gas for deploying the contract
        gasEstimate = await ContracT.signer.estimateGas(
            ContracT.getDeployTransaction(...deployArgs)
        );
    }

    return gasEstimate;
}


// return: Promise<Contract>
// hre: Hardhat Runtime Environment (HRE)
export async function upgradeContract(hre, nameContract: string, libraries = {},
    contractToUpgradeAddress: string, upgradeOptions = {}) {

    const ContracT = await hre.ethers.getContractFactory(
        nameContract, { libraries: libraries });
    const contract = await hre.upgrades.upgradeProxy(contractToUpgradeAddress, ContracT,
        upgradeOptions);

    return contract;
}

// return: Promise<Contract>
// hre: Hardhat Runtime Environment (HRE)
export async function contractAt(hre, nameContract: string, contractAddress: string) {

    let ContracT = await hre.ethers.getContractAt(nameContract, contractAddress);
    
    return ContracT;

}

export function toTimestamp(strDate: string) {
    const dt = new Date(strDate).getTime();
    return dt / 1000;
  }


export function getFirstDayOfMonth(year, month) {    return new Date(year, month, 1);}

export function getRangeFirstDayOfMonth(startDate, endDate) {
    var startYear = startDate.getFullYear();
    var startMonth = startDate.getMonth();
    var endMonth = endDate.getMonth();
    var endYear = endDate.getFullYear();
    var n_years = endYear - startYear;
    var dateRange: number[] = [];
    for (let i = 0; i < n_years; i++) {
        for (let j = 0; j < 12; j++) {

            var dateEpoch: number =
                Math.floor(new Date(getFirstDayOfMonth(startYear + i, j)
                    .setHours(0, 0, 0)).getTime() / 1000);

            if (i != 0 && i != n_years - 1) {
                dateRange.push(dateEpoch);
            }
            else if (i == 0 && j >= startMonth) {
                dateRange.push(dateEpoch);
            }
            else if (i == n_years - 1 && j <= endMonth) {
                dateRange.push(dateEpoch);
            }
        }
    }
    return dateRange;
}

export function getEpochRangeDate(firstDate: number, nIterations: number, timeDelta: number): number[] {

    var epochRange: number[] = [];
    for (let i = 0; i < nIterations-1; i++) {
        epochRange.push(firstDate + i * timeDelta);
    }
    console.log("==================================")
    console.log("dates:", epochRange);
    console.log("==================================")
    return epochRange;
}

export function getShares(nAccounts: number) {
    if ( nAccounts > 100 ) {
        return [];
    } else {
        let sharesOut: number[] = [];
        let initShare = Math.trunc(100/nAccounts);
        for (let i=0; i<nAccounts; i++) {
            sharesOut.push(initShare);
        }
        for (let i=0; i<100-initShare*nAccounts; i++) {
            sharesOut[i] = sharesOut[i] + 1;
        }

        let total = 0;
        for (let share of sharesOut) {
            total = total + share; 
        }
        console.log("total :", total);
        return sharesOut;
    }
}


