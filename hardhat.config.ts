import { HardhatUserConfig } from "hardhat/config";
// import "@nomicfoundation/hardhat-toolbox";
// import '@openzeppelin/hardhat-upgrades';
import "@nomiclabs/hardhat-web3";
import "@nomiclabs/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";


// import dob_base tasks
import "./tasks/tasks_dob_base/deploy/deployDobBase"
import "./tasks/tasks_dob_base/deploy/deployNewLogic"
import "./tasks/tasks_dob_base/deploy/deployPools"
import "./tasks/tasks_dob_base/deploy/deployTreasuryDistributionPool"
import "./tasks/tasks_dob_base/estimate/estimateGasDeployDobBase"
import "./tasks/tasks_dob_base/get/getPoolInfo"
import "./tasks/tasks_dob_base/upgrade/upgradePool"
import "./tasks/tasks_dob_base/upgrade/upgradePoolMaster"
import "./tasks/tasks_dob_base/upgrade/upgradeTokenSaleMarket"

// import tsm_tasks
import "./tasks/tasks_tsm/tsmBuyToken"
import "./tasks/tasks_tsm/tsmSetSale"

// import erc20 tasks
import "./tasks/tasks_erc20/deployERC20"
import "./tasks/tasks_erc20/transferToken"


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
    }
  },
  etherscan: {
    apiKey: {
      base: process.env.BASE_API_KEY
    }
  },
  sourcify: {
    enabled: true
  }
};
