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
- `task_dob_base`: Contains [dob](./contracts/contract/dob/)-related tasks
- `tasks_erc20`: contains [ERC20](./contracts/contract/dob/dob_token/dobToken.sol)-related tasks
- `tasks_tsm`: contains [TokenSaleMarket](./contracts/contract/dob/TokenSaleMarket.sol)-related tasks
- `task_currency`: Contains Currency-related tasks
- `tasks_staking`: Contains [Staking](./contracts/contract/staking/LockedStaking.sol)-related tasks
- `tasks_simple_staking`: Contains [SimpleStaking](./contracts/contract/staking/SimpleLockedStaking.sol)-related tasks
- `tasks_dob_sale`: Contains [DobSale](./contracts/contract/dob/dob_token/DobSale.sol)-related tasks

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


* `configureSimpleStaking`: Task to configure a new locked staking setting.
* `configureStaking`: Task to configure a new locked staking setting.
* `deployDobBase`: A task to deploy base contracts for Dob environment
* `deployDobSale`: Task to deploy the smart contract DobSale.
* `deployERC20`: Task to deploy a ERC20 token and mint initial supply
* `deployNewLogic`: Deploys a new logic contract and link it to poolMasterConfig
* `deployNewPoolVersion`: Deploys a new Pool logic version in the PoolMasterConfig
* `deployPool`: A task to deploy a pool
* `deploySimpleStaking`: Task to deploy the smart contract to manage locked staking.
* `deployStaking`: Task to deploy the smart contract to manage locked staking.
* `deployToken`: Task to deploy the ERC20 Dob Token
* `deployTreasuryDistributionPool`: A task to deploy a new treasury pool
* `depositRewardSimpleStaking`: Task to deposit reward tokens to the locked staking smart contract.
* `depositRewardStaking`: Task to deposit reward tokens to the locked staking smart contract.
* `estimateGasDeployDobBase`: A task to estimate the deploy cost of base contracts for Dob environment
* `getPoolInfo`: Get pool info
* `getPoolMasterConfigInfo`: Get poolMasterConfig info
* `getProxyImplementation`: Get the proxy implementation address
* `setSharesLimit`: Set the shares limit in the poolMasterConfig
* `transfer`: Task to transfer currency between holder address and toAddress
* `transferOwnershipSimpleStaking`: Task to transfer the ownership of a locked staking smart contract.
* `transferOwnershipStaking`: Task to transfer the ownership of a locked staking smart contract.
* `transferToken`: Task to transfer tokens between holder address and toAddress
* `tsmBuyToken`: tsmBuyToken
* `tsmSetSale`: tsmSetSale
* `upgradePool`: Upgrade a pool logic to a new implementation
* `upgradePoolMaster`: Deploys a new PoolMaster contract using UUPS upgradeable pattern
* `upgradeTokenSaleMarket`: Upgrade a token sale market logic to a new implementation


Each task includes documentation on any required or optional arguments. To get help for a specific task, run:

```sh
npx hardhat <task-name> --help
```

### Task Example cases

#### Upgrading a pool master deploy

In case you need to upgrade a pool master deploy, for example, the [deploy_base_sepolia_testnet.json](./deploys/deploy_base_sepolia_testnet.json), the steps you need to follow are:

1. add the private key of the owner of the poolMasters to `.env` file under the key `ACCOUNT_BASE_SEPOLIA`. Here you can add as many private keys as you want
2. compile the contracts with

    ```bash
    npx hardhat compile
    ```
    make sure to use node 16

3. execute the task to upgrade, for example, to upgrade our base sepolia deploy:

    ```bash
    npx hardhat --network basesepolia upgradePoolMaster ./deploys/deploy_base_sepolia_testnet.json 0x5736E3A05b34214c4757fB331682e95fF67cCd5d
    ```

    where the address must match the owner of the pool master and its private keys must be present in the environment variable `ACCOUNT_BASE_SEPOLIA`. This task will deploy new logic versions for `PoolMaster` and `PoolMasterConfig`, and then execute the upgrade calls on the proxies. The new logic are stored in the same deploy file (`./deploys/deploy_base_sepolia_testnet.json`) as a new entry in a list of logic versions.

#### Upgrading a pool logic version in the pool master

The poolMasterConfig has a pool logic version history structure, where it stores all the historic logic versions for pools. This allow for each pool to decide when and to what version should they upgrade. Each pool version will always be functional.

For example, to deploy a new pool version to our [Base Sepolia Deploy](./deploys/deploy_base_sepolia_testnet.json) we do:

1. add the private key of the owner of the poolMasters to `.env` file under the key `ACCOUNT_BASE_SEPOLIA`. Here you can add as many private keys as you want
2. compile the contracts with

    ```bash
    npx hardhat compile
    ```
    make sure to use node 16
3. execute task to deploy new logic

    ```bash
    npx hardhat --network basesepolia deployNewPoolVersion ./deploys/deploy_base_sepolia_testnet.json
    ```

    The task will validate that the owner address (present in the deploy .json file) has its private key in the `.env` file. Once complete, the task will add the new logic version 



# Current Deploys

* [Base Mainnet](./deploys/deploy_base_mainnet.json)
* [Base Sepolia Testnet](./deploys/deploy_base_sepolia_testnet.json)
* [Polygon Mainnet](./deploys/deploy_polygon_mainnet.json)
* [CELO Alfajores Testnet](./deploys/deploy_celo_alfajores_testnet.json)
* [Avalance Fuji testnet](./deploys/deploy_avalance_fuji_testnet.json)
