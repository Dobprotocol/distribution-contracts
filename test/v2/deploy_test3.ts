import { ethers } from "hardhat";
import {expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployStorage, deployLogicProxy, deployPoolLogic, deployPoolMaster, deployTreasuryPool } from "../utils/deploys";
import {Contract, Signer} from "ethers";
import { deployParticipationPool } from "../utils/deploys";

describe("Evaluate limit cases for pool master and deploys", function (){
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

    beforeEach(async function () {
        accounts = await ethers.getSigners();
        _operational = accounts[0];
        _storage = await deployStorage(accounts[1]);
        [_pm, _pmc] = await deployPoolMaster(accounts[1], _storage);
        _poolv1 = await deployPoolLogic(_storage, accounts[1], "DistributionPool");
        _poolv2 = await deployPoolLogic(_storage, accounts[1], "ParticipationPoolV2");
        console.log("initialize poolmaster")
        await _pmc.connect(accounts[1])
            .functions.initialize(_coef, _intercept, _gasPrice, _operational.address, 300);
        await _pm.connect(accounts[1])
            .functions.initialize(_pmc.address)
        console.log("initialize poolmaster - complete")
    })
    it("evaluate that only poolMaster owner can deploy a treasury pool", async function (){
        await _pmc.connect(accounts[1])
            .functions.addLogicVersion(
                _poolv1.address, 1, "DistributionPool"
            )
        await expect(
            _pm.connect(accounts[10])
                .functions.createPoolMasterTreasuryPool([accounts[2].address], [100], '')
        ).to.be.rejectedWith("Ownable: caller is not the owner")
        
        await _pm.connect(accounts[1])
            .functions.createPoolMasterTreasuryPool([accounts[2].address], [100], '')

    })
    it("evaluate that no pool can be created without a treasury pool created previously", async function (){
        await _pmc.connect(accounts[1])
            .functions.addLogicVersion(
                _poolv1.address, 1, "DistributionPool"
            )
        await expect(
            _pm.connect(accounts[3])
                .functions.createTreasuryPool(
                    [accounts[3].address, accounts[4].address, accounts[5].address], // users 
                    [40, 30, 30], // shares,
                    [0, 999, 18000],
                    '{"name": "testParticipationPool"}', // poolData,
                    {value: ethers.utils.parseUnits("0.1", "ether").toString()}
            )
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'TREASURY_POOL_NOT_CREATED'")

        await _pm.connect(accounts[1])
        .functions.createPoolMasterTreasuryPool([accounts[2].address], [100], '')

        await _pm.connect(accounts[3])
            .functions.createTreasuryPool(
                [accounts[3].address, accounts[4].address, accounts[5].address], // users 
                [40, 30, 30], // shares,
                [0, 999, 18000],
                '{"name": "testParticipationPool"}', // poolData,
                {value: ethers.utils.parseUnits("0.1", "ether").toString()}
    )
    })
    it("evaluate that no pool or treasury pool can be created without setting logic", async function () {
        await expect(
            _pm.connect(accounts[1])
                .functions.createPoolMasterTreasuryPool([accounts[2].address], [100], '')
        ).to.be.rejectedWith("NO_LOGIC_SET")

        await expect(
            _pm.connect(accounts[3])
                .functions.createTreasuryPool(
                    [accounts[3].address, accounts[4].address, accounts[5].address], // users 
                    [40, 30, 30], // shares,
                    [0, 999, 18000],
                    '{"name": "testParticipationPool"}', // poolData,
                    {value: ethers.utils.parseUnits("0.1", "ether").toString()}
            )
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'TREASURY_POOL_NOT_CREATED'")
    })
    it("evaluate that the owner of the created pool is the expected address", async function (){
        await _pmc.connect(accounts[1])
            .functions.addLogicVersion(
                _poolv1.address, 1, "DistributionPool"
            )

        let treasuryPool = await deployTreasuryPool(_pm, _pmc, accounts[5], accounts[1]);

        expect(
            (await treasuryPool.connect(accounts[1]).functions.owner())[0]
        ).to.equal(accounts[5].address);

        let _participationPool = await deployParticipationPool(
            _pm, _pmc,
            accounts[3],
            [accounts[3].address, accounts[4].address, accounts[5].address],
            [40, 30, 30],
            0, 999, 18000
        )
        expect(
            (await _participationPool.connect(accounts[1]).functions.owner())[0]
        ).to.equal(accounts[3].address);
    })
    it("evaluate that only the owner of the pool master can add new logic versions", async function (){
        await expect(
            _pmc.connect(accounts[11])
                .functions.addLogicVersion(
                    _poolv1.address, 1, "DistributionPool"
                )
        ).to.be.rejectedWith("Ownable: caller is not the owner");

        await _pmc.connect(accounts[1])
                .functions.addLogicVersion(
                    _poolv1.address, 1, "DistributionPool"
                )
            
        await expect(
            _pmc.connect(accounts[11])
                .functions.addLogicVersion(
                    _poolv2.address, 2, "ParticipationPoolV2"
                )
        ).to.be.rejectedWith("Ownable: caller is not the owner");
    })
    it("evaluate that logic version cannot ve overwritten", async function (){
        await _pmc.connect(accounts[1])
            .functions.addLogicVersion(
                _poolv1.address, 1, "DistributionPool"
            )
        
        await expect(
            _pmc.connect(accounts[1])
                .functions.addLogicVersion(
                    _poolv2.address, 1, "ParticipationPoolV2"
                )
        ).to.be.rejectedWith("LOGIC_VERSION_ALREADY_EXISTS")

        _pmc.connect(accounts[1])
            .functions.addLogicVersion(
                _poolv2.address, 3, "ParticipationPoolV2"
            )
        
        await expect(
            _pmc.connect(accounts[1])
                .functions.addLogicVersion(
                    _poolv2.address, 2, "ParticipationPoolV2"
                )
        ).to.be.rejectedWith("LOGIC_VERSION_CAN_ONLY_INCREASE")

    })
    it("evaluate that only the pool owner can update the logic version", async function(){
        await _pmc.connect(accounts[1])
            .functions.addLogicVersion(
                _poolv1.address, 1, "DistributionPool"
            )
        let treasuryPool = await deployTreasuryPool(_pm, _pmc, accounts[5], accounts[1]);

        let _participationPool = await deployParticipationPool(
            _pm, _pmc,
            accounts[3],
            [accounts[3].address, accounts[4].address, accounts[5].address],
            [40, 30, 30],
            0, 999, 18000
        )
        
        _pmc.connect(accounts[1])
            .functions.addLogicVersion(
                _poolv2.address, 3, "ParticipationPoolV2"
            )

        let logicAddress;
        await _pmc.connect(accounts[3])
            .functions.getLatestVersion()
            .then((res) =>{
                logicAddress = res._logic;
            })
        console.log("new logic addr", logicAddress);
        let prevLogicAddress = await _participationPool.functions.getImplementation();
        console.log("prev log addr", prevLogicAddress)
        expect(prevLogicAddress[0]).to.not.equal(logicAddress);
        await expect(
            _participationPool.connect(accounts[11]).functions.upgradeTo(logicAddress)
        ).to.be.rejectedWith("Ownable: caller is not the owner");
        expect(
            (await _participationPool.connect(accounts[11])
                .functions.getOperationalAddress())[0]
        ).to.equal(_operational.address);
        expect(_operational.address).to.not.equal(accounts[3].address);

        await _participationPool.connect(accounts[3]).functions.upgradeTo(logicAddress);
        let afterLogicAddress = await _participationPool.functions.getImplementation();
        console.log("after logic addr", afterLogicAddress);
        expect(afterLogicAddress[0]).to.equal(logicAddress);
        expect(
            (await _participationPool.connect(accounts[11])
                .functions.getOperationalAddress())[0]
        ).to.equal(accounts[3].address);
    })

})