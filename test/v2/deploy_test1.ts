import { ethers } from "hardhat";
import {Contract} from "ethers";
import {expect } from "chai";
import "@nomiclabs/hardhat-web3";
import { deployStorage, deployLogicProxy, deployPoolLogic } from "../utils/deploys";

describe("proving deploys without pool master", function () {
    async function initPool(pool: Contract, _storage: Contract){
        console.log(":::: initialize pool through proxy ::::")
        const accounts = await ethers.getSigners();
        const _ParticipationToken = await ethers.getContractFactory("ParticipationToken");
        const _token = await _ParticipationToken.deploy("testt", "TTT");
        console.log("1. mint token")
        await _token.connect(accounts[0])
            .functions.mint_single_owner("100000", accounts[0].address, false)
        console.log("2. define addresses")
        const _addresses = [
            accounts[1].address,
            ethers.constants.AddressZero,
            _token.address,
            accounts[2].address
        ]
        console.log("3. define vars")
        const _vars = [
            0,
            1,
            1,
            9999,
            1, 
            60000,
            0,
            0
        ]
        console.log("4. initialize")
        await pool.connect(accounts[2])
            .functions.initialize('{"name": "Test Pool"}', _addresses, _vars)
        console.log(":::: complete initialization")
    }
    
    it ("deploy a logic, then a proxy and check the state variables change", async function () {
        const accounts = await ethers.getSigners();
        const _storage = await deployStorage(accounts[0]);
        const _poolv1 = await deployPoolLogic(_storage, accounts[0], "DistributionPool");
        console.log("->Pool v1 address:", _poolv1.address, "owner", (await _poolv1.functions.owner())[0])
        for (let i =0;i < 5; i++){
            let adminRole = false;
            if (i > 0){
                await _storage.connect(accounts[0])
                    .functions.grantAdminRole(accounts[i].address)
                adminRole = true;
            }
            console.log("->account:", i, ", address:", accounts[i].address, ", admin role:", adminRole);
        }
        const _proxy = await deployLogicProxy(_storage, accounts[2]);
        await _proxy.connect(accounts[2])
            .functions.initLogic(_poolv1.address);
        console.log("attach logic")
        let pool = await _poolv1.attach(_proxy.address);
        
        let opAddress = await pool.connect(accounts[4]).functions.getOperationalAddress();
        console.log("pool operational address", opAddress[0]);
        console.log("owner:", (await pool.functions.owner())[0]);
        console.log("owner of logic:", (await _poolv1.functions.owner())[0]);
        expect(opAddress[0]).to.equal(ethers.constants.AddressZero);
        expect((await pool.functions.owner())[0]).to.equal(ethers.constants.AddressZero);
        expect((await _poolv1.functions.owner())[0]).to.equal(ethers.constants.AddressZero);
        
        await initPool(pool, _storage);

        opAddress = await pool.connect(accounts[4]).functions.getOperationalAddress();
        console.log("pool operational address", opAddress[0]);
        console.log("owner:", (await pool.functions.owner())[0]);
        console.log("owner of logic:", (await _poolv1.functions.owner())[0]);
        expect(opAddress[0]).to.equal(accounts[1].address);
        expect((await pool.functions.owner())[0]).to.equal(accounts[2].address);
        expect((await _poolv1.functions.owner())[0]).to.equal(ethers.constants.AddressZero);

    })
    it ("deploy a proxy and initialize it through initProxyAndCall", async function() {

        const accounts = await ethers.getSigners();
        const _storage = await deployStorage(accounts[0]);
        const _poolv2 = await deployPoolLogic(_storage, accounts[0], "ParticipationPoolV2");
        console.log("->Pool v1 address:", _poolv2.address, "owner", (await _poolv2.functions.owner())[0])
        const _proxy = await deployLogicProxy(_storage, accounts[0]);
        console.log("porxy owner", await _proxy.functions.owner())

        // await _proxy.connect(accounts[0])
        //     .functions.initLogic(_poolv1.address)

        console.log("1. mint token")
        const _ParticipationToken = await ethers.getContractFactory("ParticipationToken");
        const _token = await _ParticipationToken.deploy("testt", "TTT");
        await _token.connect(accounts[0])
            .functions.mint_single_owner("100000", accounts[0].address, false)
    
        console.log("2. define addresses")
        // const _addresses = {
        //     _storage: _storage.address,
        //     operational: accounts[1].address,
        //     treasury: ethers.constants.AddressZero,
        //     creator: accounts[0].address,
        //     token: _token.address
        // }
        // const _addresses = ethers.utils.AbiCoder.prototype.encode(
        //     ["address", "address", "address", "address", "address"],
        //     [accounts[0].address, accounts[1].address, ethers.constants.AddressZero, _token.address, _storage.address]
        // )
        const _addresses = [
            accounts[1].address, 
            ethers.constants.AddressZero, 
            _token.address, 
            accounts[2].address
        ]
        // console.log("_addresses", _addresses)

        console.log("3. define vars")
        // const _vars = {
        //     isPublic: true,
        //     commission: 0,
        //     coef: 1,
        //     intercept: 1,
        //     nDistributions: 9999,
        //     index: 0,
        //     firstDistributionDate: 1,
        //     prevDistributionDate: 0,
        //     distributionInterval: 60000
        // }
        // const _vars = ethers.utils.AbiCoder.prototype.encode(
        //     ["bool", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256"],
        //     [true, 0, 1, 1, 9999, 0, 1, 0, 60000]
        // )
        const _vars = [0, 1, 1, 9999, 1, 60000, 0, 0]

        // console.log("_vars", _vars)


        let data = await _poolv2.connect(accounts[0])
            .functions.abiEncodeInitialize('{"name": "Test Pool"}', _addresses, _vars)
        console.log("data", data);

        await _proxy.connect(accounts[2])
            .functions.initLogicAndCall(_poolv2.address, data[0]);

        console.log("attach logic")
        let pool = await _poolv2.attach(_proxy.address);
        let owner = await pool.connect(accounts[4]).functions.owner();
        console.log("pool owner address", owner[0]);
        expect(owner[0]).to.equal(accounts[2].address);

    })

    it ("deploy two logic version, then a proxy, initialize, update logic and check changes", async function () {
        const accounts = await ethers.getSigners();
        // deploy storage, logic v1 and v2
        const _storage = await deployStorage(accounts[0]);
        const _poolv1 = await deployPoolLogic(_storage, accounts[0], "DistributionPool");
        console.log("->Pool v1 address:", _poolv1.address, "owner", (await _poolv1.functions.owner())[0])
        expect((await _poolv1.functions.owner())[0]).to.equal(ethers.constants.AddressZero)
        const _poolv2 = await deployPoolLogic(_storage, accounts[0], "ParticipationPoolV2");
        console.log("->Pool v2 address:", _poolv2.address, "owner", (await _poolv2.functions.owner())[0])
        expect((await _poolv2.functions.owner())[0]).to.equal(ethers.constants.AddressZero)
        for (let i =0;i < 5; i++){
            let adminRole = false;
            if (i > 0){
                await _storage.connect(accounts[0])
                    .functions.grantAdminRole(accounts[i].address)
                adminRole = true;
            }
            console.log("->account:", i, ", address:", accounts[i].address, ", admin role:", adminRole);
        }
        // deploy proxy and init with logic v1
        const _proxy = await deployLogicProxy(_storage, accounts[2]);
        await _proxy.connect(accounts[2])
            .functions.initLogic(_poolv1.address);
        console.log("->attach logic v1")
        let pool = await _poolv1.attach(_proxy.address);
        let opAddress = await pool.connect(accounts[4]).functions.getOperationalAddress()
        expect(opAddress[0]).to.equal(ethers.constants.AddressZero);

        // initialize logic through proxy
        await initPool(pool, _storage);
        opAddress = await pool.connect(accounts[4]).functions.getOperationalAddress()
        expect(opAddress[0]).to.equal(accounts[1].address);

        // change logic version
        await pool.connect(accounts[2])
            .functions.upgradeTo(_poolv2.address);
        pool = await _poolv2.attach(_proxy.address);

        opAddress = await pool.connect(accounts[4]).functions.getOperationalAddress()
        expect(opAddress[0]).to.equal(accounts[2].address);
    })
})