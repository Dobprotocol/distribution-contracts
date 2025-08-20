import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-web3";
import "@nomiclabs/hardhat-ethers";

// TODO: the modules hardhat-toolbox and hardhat-upgrades have collision with hardhat-verify
// so depending on the use case you plan you must enable one or another
// 
// if you want to run tests and develop code, then use hardhat-toolbox and upgrades
import "@nomicfoundation/hardhat-toolbox";
import '@openzeppelin/hardhat-upgrades';
// if you want to verify a deploy, then disable the other 2 modules and use hardhat-verify
// import "@nomicfoundation/hardhat-verify";
//


// import dob_base tasks
import "./tasks/tasks_dob_base/deploy/deployDobBase"
import "./tasks/tasks_dob_base/deploy/deployNewLogic"
import "./tasks/tasks_dob_base/deploy/deployNewPoolVersion"
import "./tasks/tasks_dob_base/deploy/deployPool"
import "./tasks/tasks_dob_base/deploy/deployTreasuryDistributionPool"
import "./tasks/tasks_dob_base/estimate/estimateGasDeployDobBase"
import "./tasks/tasks_dob_base/get/getPoolInfo"
import "./tasks/tasks_dob_base/get/getProxyImplementation"
import "./tasks/tasks_dob_base/get/getPoolMasterConfigInfo"
import "./tasks/tasks_dob_base/upgrade/upgradePool"
import "./tasks/tasks_dob_base/upgrade/upgradePoolMaster"
import "./tasks/tasks_dob_base/upgrade/upgradeTokenSaleMarket"
import "./tasks/tasks_dob_base/set/setSharesLimit"

// import tsm_tasks
import "./tasks/tasks_tsm/tsmBuyToken"
import "./tasks/tasks_tsm/tsmSetSale"

// import erc20 tasks
import "./tasks/tasks_erc20/deployERC20"
import "./tasks/tasks_erc20/transferToken"

// import currency tasks
import "./tasks/tasks_currency/transfer"

// staking tasks
import "./tasks/tasks_staking/deployStaking"
import "./tasks/tasks_staking/depositRewardStaking"
import "./tasks/tasks_staking/configureStaking"
import "./tasks/tasks_staking/transferOwnershipStaking"

// simple staking tasks
import "./tasks/tasks_simple_staking/deployStaking"
import "./tasks/tasks_simple_staking/depositRewardStaking"
import "./tasks/tasks_simple_staking/configureStaking"
import "./tasks/tasks_simple_staking/transferOwnershipStaking"

// erc20 tasks
import "./tasks/erc20/deployToken"

// DobSale tasks
import "./tasks/tasks_dob_sale/deployDobSale"


require('hardhat-contract-sizer');
require('dotenv').config()
// require("@nomiclabs/hardhat-etherscan");

const config: HardhatUserConfig = {
  solidity: "0.8.17",
  networks: {
    customTest: { allowUnlimitedContractSize: true }
  }
};

export default config;



module.exports = {
  solidity: {
    version: "0.8.11",
    settings: {
      optimizer: {
        enabled: true,
        runs: 10,
      },
    },
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
    only: [],
  },
  networks: { 
    polygon: {
      url: process.env.POLYGON_URL || "",
      accounts:
        process.env.ACCOUNT_POLYGON?.split(",")
    },
    amoy: {
      url: process.env.AMOY_URL || "",
      accounts:
        process.env.ACCOUNT_AMOY?.split(",")
    },
    alfajores: {
      url: "https://alfajores-forno.celo-testnet.org",
      accounts:
        process.env.ACCOUNT_ALFAJORES?.split(",")
    },
    hardhat: {
      accounts: {
        initialIndex: 0,
        count: 105,
      },
      hardfork: "london"
    },
    ethsepolia: {
      url: process.env.ETH_SEPOLIA_URL || "",
      accounts:
        process.env.ACCOUNT_ETH_SEPOLIA?.split(",")
    },
    avaxfuji: {
      url: "https://api.avax-test.network/ext/bc/C/rpc",
      accounts:
        process.env.ACCOUNT_AVAX_FUJI?.split(",")
    },
    base: {
      url: "https://mainnet.base.org/",
      accounts:
      process.env.ACCOUNT_BASE?.split(",")
    },
    basesepolia: {
      url: process.env.BASE_SEPOLIA_URL ||"https://base-sepolia.drpc.org",
      accounts:
      process.env.ACCOUNT_BASE_SEPOLIA?.split(",")
    }
  },
  etherscan: {
    apiKey: {
      base: process.env.BASE_API_KEY,
      baseSepolia: process.env.BASE_API_KEY
    }
  },
  sourcify: {
    enabled: true
  }
};
