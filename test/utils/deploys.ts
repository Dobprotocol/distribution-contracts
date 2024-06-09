import { ethers, upgrades } from "hardhat"
import { Contract, Signer } from "ethers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export async function deployStorage(creator: Signer):Promise<Contract>{
    const OperatoryStorage = await ethers.getContractFactory("EternalStorage");
    const _storage = await OperatoryStorage.connect(creator).deploy();
    console.log("->Storage address is:", _storage.address);
    return _storage;
}

export async function deployTokenSaleMarket(
    creator: SignerWithAddress, owner: SignerWithAddress, _storage:Contract, commission: number
):Promise<[Contract, Contract]>{
    const TSM = await ethers.getContractFactory("TokenSaleMarket");
    const _tsm = await TSM.connect(creator).deploy(_storage.address);
    const PROXY = await ethers.getContractFactory("LogicProxy");
    const _proxy = await PROXY.connect(creator).deploy(_storage.address, "TokenSaleMarket");
    await _storage.connect(creator)
        .functions.grantUserRole(_proxy.address);
    await _proxy.connect(creator).functions.initLogic(_tsm.address);
    let tsm = _tsm.attach(_proxy.address);
    await tsm.connect(creator)
        .functions.initialize(owner.address, commission)
    return [_tsm, _proxy]
    
}

export async function deployExternalToken(
    creator: Signer, name: string, symbol: string, supply: string
) : Promise<Contract>{
    const ERC20Token = await ethers.getContractFactory("TestToken");
    const extToken = await ERC20Token.connect(creator).deploy(name, symbol, supply)
    return extToken
}

export async function deployPoolMaster(creator: Signer, _storage: Contract): Promise<[Contract, Contract]>{
    const PoolMasterConfig = await ethers.getContractFactory("PoolMasterConfig");
    const PoolMaster = await ethers.getContractFactory("PoolMaster");
    const PROXY = await ethers.getContractFactory("LogicProxy");

    const _pmc = await PoolMasterConfig.connect(creator).deploy(_storage.address);
    const _proxy_pmc = await PROXY.connect(creator).deploy(_storage.address, "PoolMasterConfig.proxy");
    console.log("->Pool master config proxy address is:", _proxy_pmc.address);
    await _storage.connect(creator)
        .functions.grantUserRole(_proxy_pmc.address);
    await _storage.connect(creator)
        .functions.grantAdminRole(_proxy_pmc.address);
    await _proxy_pmc.connect(creator).functions.initLogic(_pmc.address);
    let pmc = _pmc.attach(_proxy_pmc.address);
    console.log("-->Pool master config address is:", pmc.address);

    const _pm = await PoolMaster.connect(creator).deploy(_storage.address);
    const _proxy_pm = await PROXY.connect(creator).deploy(_storage.address, "PoolMaster.proxy");
    console.log("->Pool master deployer proxy address is:", _proxy_pm.address);
    await _storage.connect(creator)
        .functions.grantUserRole(_proxy_pm.address);
    await _storage.connect(creator)
        .functions.grantAdminRole(_proxy_pm.address);
    await _proxy_pm.connect(creator).functions.initLogic(_pm.address);
    let pm = _pm.attach(_proxy_pm.address);
    console.log("-->Pool master deployer address is:", pm.address);
    return [pm, pmc]
}

export async function deployPoolLogic(
    _storage: Contract, 
    creator: Signer, 
    _name: string = "DistributionPool"
) : Promise<Contract>{
    const Pool = await ethers.getContractFactory(_name);
    const _pool = await Pool.connect(creator).deploy(_storage.address);
    await _storage.connect(creator)
        .functions.grantUserRole(_pool.address);
    return _pool
}

export async function deployLogicProxy(
    _storage: Contract, 
    creator: Signer, 
    name: string = "TestLogic"
) : Promise<Contract>{
    const LogicProxy = await ethers.getContractFactory("LogicProxy");
    const _proxy = await LogicProxy.connect(creator).deploy(_storage.address, name)
    await _storage.connect(creator)
        .functions.grantUserRole(_proxy.address);
    console.log("->Logic proxy address:", _proxy.address);
    return _proxy
}

export async function deployTreasuryPool(
    _pm: Contract, _pmc: Contract, poolOwner: SignerWithAddress, creator: Signer
) : Promise<Contract>{

    let txData = await _pm.connect(creator)
        .functions.createPoolMasterTreasuryPool([poolOwner.address], [100], '{"name": "DobTreasury"}');
    
    let txRes = await txData.wait()
    // get deployed pool address and logic version user
    let poolAddress = ethers.constants.AddressZero
    let _logicVersion = 0
    for (let event of txRes.events){
        if (event.event == "CreatePool"){
            poolAddress = event.args.contractAddress
            _logicVersion = event.args.logicVersion
            console.log(
                "-> deployed participation pool address is:", poolAddress,
                "with logic version", _logicVersion);
        }
    }

    // get logic name and address asociated with the logic version
    let logicName;
    let logicAddress;
    await _pmc.connect(poolOwner)
        .functions.getLogicVersion(_logicVersion)
        .then((res) => {
            logicName = res._name;
            logicAddress = res._logic;
        })
    // console.log(logicName, logicAddress)
    // instanciate that logic
    let _logic = await ethers.getContractAt(logicName, poolAddress);
    // then attach to pool proxy to call its delegate methods
    let pool = await _logic.attach(poolAddress);
    return pool
}

async function _instanciatePool(
    txRes, _pmc: Contract, poolOwner: Signer
) : Promise<Contract>{
    let poolAddress = ethers.constants.AddressZero
    let _logicVersion = 0
    for (let event of txRes.events){
        if (event.event == "CreatePool"){
            poolAddress = event.args.contractAddress
            _logicVersion = event.args.logicVersion
            console.log(
                "-> deployed participation pool address is:", poolAddress,
                "with logic version", _logicVersion);
        }
    }
    // get logic name and address asociated with the logic version
    let logicName;
    let logicAddress;
    await _pmc.connect(poolOwner)
        .functions.getLogicVersion(_logicVersion)
        .then((res) => {
            logicName = res._name;
            logicAddress = res._logic;
        })
    console.log(logicName, logicAddress)
    // instanciate that logic
    let _logic = await ethers.getContractAt(logicName, poolAddress);
    // then attach to pool proxy to call its delegate methods
    let pool = await _logic.attach(poolAddress);
    return pool
}

export async function deployParticipationPool(
    _pm: Contract, _pmc: Contract, poolOwner: Signer, poolUsers: string[], poolShares: number[],
    firstDistributionDate: number, nDistributions: number = 999, 
    distributionInterval: number = 10000, poolData: string = '{"name": "testParticipationPool"}',
    prepay: string = ethers.utils.parseUnits("0.1", "ether").toString()
) : Promise<Contract> {
    // use reward pools
    let txData = await _pm.connect(poolOwner)
        .functions.createRewardPool(
            poolUsers, // users 
            poolShares, // shares
            0,
            poolData, // poolData, json serialized
            {value: prepay}
        )
    let txRes = await txData.wait()
    // get deployed pool address and logic version user
    return _instanciatePool(txRes, _pmc, poolOwner);
}

export async function deployRewardPool(
    _pm: Contract, _pmc: Contract, poolOwner: Signer, poolUsers: string[], poolShares: number[],
    goalAmout: string, poolData: string = '{"name": "testParticipationPool"}',
    prepay: string = ethers.utils.parseUnits("0.1", "ether").toString()
) : Promise<Contract> {
    let txData = await _pm.connect(poolOwner)
        .functions.createRewardPool(
            poolUsers, // users 
            poolShares, // shares
            goalAmout,
            poolData, // poolData, json serialized
            {value: prepay}
        )
    let txRes = await txData.wait()
    // get deployed pool address and logic version user
    return _instanciatePool(txRes, _pmc, poolOwner);
}

export async function deployPayrollPool(
    _pm: Contract, _pmc: Contract, poolOwner: Signer, poolUsers: string[], poolShares: number[],
    goalAmount: string, firstDistributionDate: number, nDistributions: number = 999, 
    distributionInterval: number = 10000, poolData: string = '{"name": "testParticipationPool"}',
    prepay: string = ethers.utils.parseUnits("0.1", "ether").toString()
) : Promise<Contract> {
    let txData = await _pm.connect(poolOwner)
        .functions.createPayrollPool(
            poolUsers, // users 
            poolShares, // shares
            [firstDistributionDate, nDistributions, distributionInterval],
            goalAmount,
            poolData, // poolData, json serialized
            {value: prepay}
        )
    let txRes = await txData.wait()
    // get deployed pool address and logic version user
    return _instanciatePool(txRes, _pmc, poolOwner);
}

export async function deployTreasuryTypePool(
    _pm: Contract, _pmc: Contract, poolOwner: Signer, poolUsers: string[], poolShares: number[],
    firstDistributionDate: number, nDistributions: number = 999, 
    distributionInterval: number = 10000, poolData: string = '{"name": "testParticipationPool"}',
    prepay: string = ethers.utils.parseUnits("0.1", "ether").toString()
) : Promise<Contract> {
    let txData = await _pm.connect(poolOwner)
        .functions.createTreasuryPool(
            poolUsers, // users 
            poolShares, // shares
            [firstDistributionDate, nDistributions, distributionInterval],
            poolData, // poolData, json serialized
            {value: prepay}
        )
    let txRes = await txData.wait()
    // get deployed pool address and logic version user
    return _instanciatePool(txRes, _pmc, poolOwner);
}