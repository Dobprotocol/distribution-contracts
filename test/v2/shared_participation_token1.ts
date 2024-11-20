import { ethers } from "hardhat";
import {expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployStorage, deployLogicProxy, deployPoolLogic, deployPoolMaster, deployTreasuryTypePool } from "../utils/deploys";
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
    it("Deploy a pool with auto-generated participation token, and then another pool with the same participation token", async function (){
        console.log("create treasury pool")
        await expect(
            _pm.connect(accounts[1]).functions.getTreasuryPool()
        ).to.be.rejectedWith("TREASURY_POOL_NOT_CREATED");
        let txData = await _pm.connect(accounts[1])
            .functions.createPoolMasterTreasuryPool(
                [accounts[2].address], [100], '{"name": "Pool Master Treasury Pool"}'
                );

        let pool = await deployTreasuryTypePool(
            _pm, _pmc, accounts[3],
            [accounts[3].address, accounts[4].address, accounts[5].address],
            [40, 30, 30], 0, 999, 18000
        )

        let participationTokenAddress = (await pool.functions.getParticipationToken())[0]
        console.log("participationTokenAddress:", participationTokenAddress)

        // create a new pool with the same shares
        let pool2 = await deployTreasuryTypePool(
            _pm, _pmc, accounts[3],
            [accounts[3].address],
            [], 0, 999, 18000, participationTokenAddress
        )
        
        // address 4 sends its participation to address 6
        let participationToken = await ethers.getContractAt("ParticipationToken", participationTokenAddress);

        let balance = (await participationToken.functions.balanceOf(accounts[4].address))[0]
        console.log("transfering balance", balance, "from", accounts[4].address, "to", accounts[6].address)
        await participationToken.connect(accounts[4]).transfer(accounts[6].address, balance)
        
        // then deposit some funds to the second pool
        await pool.connect(accounts[1]).functions.deposit({value: ethers.utils.parseEther("1")})
        await pool2.connect(accounts[1]).functions.deposit({value: ethers.utils.parseEther("1")})

        // and try to distribute on old accounts
        await expect(
            pool2.connect(accounts[3]).functions.distribute(
                [accounts[3].address, accounts[4].address, accounts[5].address],
                ethers.constants.AddressZero
            )
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'User address has no participation'")

        await expect(
            pool.connect(accounts[3]).functions.distribute(
                [accounts[3].address, accounts[4].address, accounts[5].address],
                ethers.constants.AddressZero
            )
        ).to.be.rejectedWith("VM Exception while processing transaction: reverted with reason string 'User address has no participation'")

        // then try to distribute with correct accounts
        await pool2.connect(accounts[3]).functions.distribute(
            [accounts[3].address, accounts[6].address, accounts[5].address],
            ethers.constants.AddressZero
        )
        await pool.connect(accounts[3]).functions.distribute(
            [accounts[3].address, accounts[6].address, accounts[5].address],
            ethers.constants.AddressZero
        )
    })
})