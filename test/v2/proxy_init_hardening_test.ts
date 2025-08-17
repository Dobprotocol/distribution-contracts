import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { deployStorage, deployLogicProxy, deployPoolLogic } from "../utils/deploys";

describe("Proxy init hardening behavior", function () {
  it("atomic init via initLogicAndCall succeeds and marks initialized", async function () {
  const [deployer, user] = await ethers.getSigners();
    const storage = await deployStorage(deployer);
    const logic = await deployPoolLogic(storage, deployer, "DistributionPool");
  // Deploy proxy and grant roles using the admin (deployer)
  const proxy: Contract = await deployLogicProxy(storage, deployer);

    // Build initializer calldata
    const ParticipationToken = await ethers.getContractFactory("ParticipationToken");
    const token = await ParticipationToken.deploy("testt", "TTT");
    await token.connect(deployer).functions.mint_single_owner("100000", deployer.address, false);

    const addresses = [deployer.address, ethers.constants.AddressZero, token.address, user.address];
    const vars = [0, 1, 1, 9999, 1, 60000, 0, 0];
    const initData = logic.interface.encodeFunctionData(
      "initialize",
      ['{"name":"Test"}', addresses, vars]
    );

    await expect(
      proxy.connect(user).functions.initLogicAndCall(logic.address, initData)
    ).to.emit(proxy, "Upgraded");

    const pool = logic.attach(proxy.address);
    const owner = await pool.functions.owner();
    expect(owner[0]).to.equal(user.address);

    // Second init attempt should revert with PROXY_ALREADY_INITIALIZED
    await expect(
      proxy.connect(user).functions.initLogicAndCall(logic.address, initData)
    ).to.be.revertedWith("PROXY_ALREADY_INITIALIZED");
  });

  it("non-initializer cannot front-run after init; before init any user with USER_ROLE on proxy could call", async function () {
  const [deployer, userA, userB] = await ethers.getSigners();
    const storage = await deployStorage(deployer);
    const logic = await deployPoolLogic(storage, deployer, "DistributionPool");
  // Deploy proxy via admin so role grants succeed
  const proxy: Contract = await deployLogicProxy(storage, deployer);

    const ParticipationToken = await ethers.getContractFactory("ParticipationToken");
    const token = await ParticipationToken.deploy("testt", "TTT");
    await token.connect(deployer).functions.mint_single_owner("100000", deployer.address, false);
    const addresses = [deployer.address, ethers.constants.AddressZero, token.address, userA.address];
    const vars = [0, 1, 1, 9999, 1, 60000, 0, 0];
    const initData = logic.interface.encodeFunctionData(
      "initialize",
      ['{"name":"Test"}', addresses, vars]
    );

    // userA performs atomic init
    await proxy.connect(userA).functions.initLogicAndCall(logic.address, initData);

    // userB cannot re-init after done
    await expect(
      proxy.connect(userB).functions.initLogicAndCall(logic.address, initData)
    ).to.be.revertedWith("PROXY_ALREADY_INITIALIZED");
  });
});
