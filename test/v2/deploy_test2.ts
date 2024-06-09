import { ethers } from "hardhat";
import {expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployStorage, deployLogicProxy, deployPoolLogic, deployPoolMaster } from "../utils/deploys";
import {Contract, Signer} from "ethers";

describe("proving deploys with pool master", function () {
    let accounts;
    let _operational;
    const _coef = 1;
    const _intercept = 1;
    const _gasPrice = 1;
    let _storage: Contract;
    let _pm: Contract;
    let _pmc: Contract;
    let _poolv1: Contract;
    let _poolv2: Contract;
    beforeEach(async function() {
        accounts = await ethers.getSigners();
        _operational = accounts[0];
        _storage = await deployStorage(accounts[1]);
        [_pm, _pmc] = await deployPoolMaster(accounts[1], _storage);
        console.log("pm", _pm.address, "pmc", _pmc.address);
        _poolv1 = await deployPoolLogic(_storage, accounts[1], "DistributionPool");
        _poolv2 = await deployPoolLogic(_storage, accounts[1], "ParticipationPoolV2");
        console.log("initialize poolmaster")
        await _pmc.connect(accounts[1])
            .functions.initialize(_coef, _intercept, _gasPrice, _operational.address, 300);
        console.log("get commission:", await _pmc.connect(accounts[1]).functions.getCommission())
        await _pm.connect(accounts[1])
            .functions.initialize(_pmc.address)
        console.log("add logic version 1")
        await _pmc.connect(accounts[1])
            .functions.addLogicVersion(
                _poolv1.address, 1, "DistributionPool"
            )
        console.log("latest logic version:", await _pmc.connect(accounts[1]).functions.getLatestVersion())


    })
    it("deploy a poolMaster and its treasury pool", async function () {

        console.log("create treasury pool")
        await expect(
            _pm.connect(accounts[1]).functions.getTreasuryPool()
        ).to.be.rejectedWith("TREASURY_POOL_NOT_CREATED");
        let txData = await _pm.connect(accounts[1])
            .functions.createPoolMasterTreasuryPool(
                [accounts[2].address], [100], '{"name": "Pool Master Treasury Pool"}'
                );
        let txRes = await txData.wait()
        let treasuryAddress = ethers.constants.AddressZero
        for (let event of txRes.events){
            if (event.event == "CreatePool"){
                console.log("deployed treasury address is:",event.args.contractAddress);
                treasuryAddress = event.args.contractAddress
            }
        }
        expect(
            (await _pm.connect(accounts[1]).functions.getTreasuryPool())[0]
        ).to.equal(treasuryAddress)
    })

    it("deploy poolMaster, treasury and participationPool, then update its logic", async function(){
        console.log("create treasury pool")
        await _pm.connect(accounts[1])
            .functions.createPoolMasterTreasuryPool(
                [accounts[2].address], [100], '{"name": "Pool Master Treasury Pool"}'
                );
        console.log("create a participation pool")

        let txData = await _pm.connect(accounts[3])
            .functions.createTreasuryPool(
                [accounts[3].address, accounts[4].address, accounts[5].address], // users 
                [40, 30, 30], // shares,
                [0, 999, 18000],
                '{"name": "testParticipationPool"}', // poolData,
                {value: ethers.utils.parseUnits("0.1", "ether").toString()}
            )
        let txRes = await txData.wait()
        // get deployed pool address and logic version user
        let poolAddress = ethers.constants.AddressZero
        let _logicVersion = 0
        for (let event of txRes.events){
            if (event.event == "CreatePool"){
                poolAddress = event.args.contractAddress
                _logicVersion = event.args.logicVersion
                console.log(
                    "deployed participation pool address is:", poolAddress,
                    "with logic version", _logicVersion);
            }
        }
        // check that deployed pool address is not 0
        expect(poolAddress).to.not.equal(ethers.constants.AddressZero);
        // check that used logic version is not 0
        expect(_logicVersion).to.not.equal(0);
        // get logic name and address asociated with the logic version
        let logicName;
        let logicAddress;
        await _pmc.connect(accounts[0])
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
        // check that the pool was initialized by validating the owner and operational address
        let owner = await pool.connect(accounts[0]).functions.owner();
        expect(owner[0]).to.equal(accounts[3].address);
        expect(
            (await pool.connect(accounts[0]).functions.getOperationalAddress())[0]
        ).to.equal(_operational.address);
        expect((await pool.connect(accounts[0]).functions.getPrepayAmount())[0]).to.equal(ethers.utils.parseUnits("0.1", "ether").toString());
        // add a new logic
        await _pmc.connect(accounts[1])
            .functions.addLogicVersion(_poolv2.address, 2, "ParticipationPoolV2");
        // upgrade the proxy pool to this new logic
        await pool.connect(accounts[3])
            .functions.upgradeTo(_poolv2.address)
        // attach with the new logic
        pool = await _poolv2.attach(poolAddress);
        
        // check changes on this new logic, in particular, on ParticipationPoolV2
        // the getOperationalAddress() == owner()
        expect(
            (await pool.connect(accounts[0]).functions.getOperationalAddress())[0]
        ).to.not.equal(_operational.address);
        expect(
            (await pool.connect(accounts[0]).functions.getOperationalAddress())[0]
        ).to.equal(accounts[3].address);
    })
    it("validate estimation of prepay", async function () {
        await _pmc.connect(accounts[1])
            .functions.expectedTotalGas(10, 100)
            .then((res) => {
                console.log("res", res.amount)
                expect(res.amount.toString()).to.not.equal("0")
            })
    })
})