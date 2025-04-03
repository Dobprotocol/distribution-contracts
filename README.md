# Dob-SC

## Requirements

- Node v16.13.2

This repository is used to develop, deploy, and test Dob smart contracts. Follow the steps below to get started.

## Installation

First, install the necessary packages:

```sh
npm install
```

## Compilation

Next, compile the contracts using Hardhat:

```sh
npx hardhat compile
```

## Testing

To run the tests on the Hardhat default test network, use:

```sh
npx hardhat test 
```

## Configurations

The [Hardhat configuration file](./hardhat.config.ts) defines settings for the following networks:

- Polygon mainnet -> `polygon`
- Polygon testnet -> `amoy`
- Celo Testnet -> `alfajores`
- Ethereum testnet (sepolia) -> `ethsepolia`
- Base mainnet -> `base`
- Base testnet (sepolia) -> `basesepolia`

Some of these networks require you to provide RPC URLs in the `.env` file. Additionally, you will need to provide the private key of the deployer account in the `.env` file for each network. To help with this, an [example .env file](./.env.example) is provided.

## Hardhat Tasks

We have created various Hardhat tasks to facilitate interaction with the contracts. These tasks are organized in the [tasks folder](./tasks/) with the following structure:

- `configs`: Contains example config `.json` files used to run some tasks.
- `utils`: contains utility functions.
- `task_dob_base`: Contains dob-related tasks
- `tasks_erc20`: contains erc20-related tasks
- `tasks_tsm`: contains TokenSaleMarket-related tasks

The currently existent Tasks are:

* `deployDobBase`: A task to deploy base contracts for Dob enviroment
* `deployERC20`: task to deploy a ERC20 token and mint initial supply
* `deployNewLogic`: Deploys a new logic contract and link it to poolMasterConfig
* `deployPools`: A task to deploy a set of pools
* `deployTreasuryDistributionPool`: A task to deploy a new treasury pool
* `estimateGasDeployDobBase`: A task to estimate the deploy cost of base contracts for Dob enviroment
* `getPoolInfo`: get pool info
* `transferToken`: task to deploy the ERC20 Dob Token 
* `tsmBuyToken`: tsmBuyToken
* `tsmSetSale`: tsmSetSale
* `upgradePool`: Upgrade a pool logic to a new implementation
* `upgradePoolMaster`: Deploys a new PoolMaster contract using UUPS upgradeable pattern
* `upgradeTokenSaleMarket`: Upgrade a token sale market logic to a new implementation

Each task includes documentation on any required or optional arguments. To get help for a specific task, run:

```sh
npx hardhat <task-name> --help
```

# Current Working Deploys

* [Base Mainnet](./deploys/deploy_base_mainnet.json)
* [Base Sepolia Testnet](./deploys/deploy_base_sepolia_testnet.json)
* [Polygon Mainnet](./deploys/deploy_polygon_mainnet.json)
* [CELO Alfajores Testnet](./deploys/deploy_celo_alfajores_testnet.json)
* [Avalance Fuji testnet](./deploys/deploy_avalance_fuji_testnet.json)
