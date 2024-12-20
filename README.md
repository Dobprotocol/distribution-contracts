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
- Ethereum testnet -> `ethsepolia`

Some of these networks require you to provide RPC URLs in the `.env` file. Additionally, you will need to provide the private key of the deployer account in the `.env` file for each network. To help with this, an [example .env file](./.env.example) is provided.

## Hardhat Tasks

We have created various Hardhat tasks to facilitate interaction with the contracts. These tasks are organized in the [tasks folder](./tasks/) with the following structure:

- `configs`: Contains the config `.json` files used to run some tasks.
- `deploys`: Contains the output `.json` files with detailed data of deployed contracts.
- `gasExperiments`: Contains specific `.json` files used for gas experiments.
- `subtasks`: Contains the logic used in tasks, including subtasks and utility functions.
- `*.ts`: Task files.

The currently existent Tasks are:

* `deployDobBase`: deploys the core contracts for our Dob platform.
* `deployDobToken`: Deploy the ERC20 Dob Token.
* `deployNewLogic`: Deploys new pool logic versions and link it to our Pool Master.
* `upgradePool`: perform the logic upgrade of a pool following the UUPS proxy pattern.
* `upgradePoolMaster`: perfom the logic upgrade of a pool master following the UUPS proxy pattern.
* `upgradeTokenSaleMarket`: perform the logic upgrade of a Token Sale Master following the UUPS proxy pattern.

Each task includes documentation on any required or optional arguments. To get help for a specific task, run:

```sh
npx hardhat <task-name> --help
```

## Deploy Dob Base Contracts

```sh
Usage: hardhat [GLOBAL OPTIONS] deployDobBase [--input-config-file <STRING>] [--output-config-file <STRING>] [--output-config-tag <STRING>]

OPTIONS:
  --input-config-file   Name of the input config file to use (default: "dob_base.json")
  --output-config-file  Name of the output config file to use (default: "None")
  --output-config-tag   Tag used to identify output files (default: "dobBase")

deployDobBase: A task to deploy base contracts for the Dob environment.
```

## Deploy Dob Token

```bash
Usage: hardhat [GLOBAL OPTIONS] deployDobToken [--deploy-config <STRING>] [--output-config-tag <STRING>]

OPTIONS:

  --deploy-config       the deploy config (default: "dob_token.json")
  --output-config-tag   tag used to identify output files (default: "dobToken")

deployDobToken: task to deploy the ERC20 Dob Token and its timeLock contract
```

## Deploy New Logic

```bash
Usage: hardhat [GLOBAL OPTIONS] deployNewLogic [--input-config-file <STRING>] [--output-config-file <STRING>]

OPTIONS:

  --input-config-file   Name of the input config to use (default: "dob_base.json")
  --output-config-file  tag used to identify output files (default: "dobBase.json")

deployNewLogic: Deploys a new logic contract and link it to poolMasterConfig
```

## Upgrade Pool

```sh
Usage: hardhat [GLOBAL OPTIONS] upgradePool [--logic-version <STRING>] [--output-config-file <STRING>] [--owner <STRING>] [--pool-address <STRING>]

OPTIONS:
  --logic-version       Specify the logic version to use (default: "1")
  --output-config-file  Name of the output config file to use (default: "dobBase.json")
  --owner               Address of the pool owner (default: "none")
  --pool-address        Address of the pool to be upgraded (default: "none")

upgradePool: Upgrade a pool's logic to a new implementation.
```

## Upgrade Pool Master

```sh
Usage: hardhat [GLOBAL OPTIONS] upgradePoolMaster [--input-config-file <STRING>] [--output-config-file <STRING>] [--owner <STRING>]

OPTIONS:
  --input-config-file   Name of the input config file to use (default: "dob_base.json")
  --output-config-file  Name of the output config file to use (default: "dobBase.json")
  --owner               Address of the pool owner (default: "none")

upgradePoolMaster: Deploy a new PoolMaster contract using the UUPS upgradeable pattern.
```

## Upgrade Token Sale Market

```sh
Usage: hardhat [GLOBAL OPTIONS] upgradeTokenSaleMarket [--output-config-file <STRING>] [--tsm-logic <STRING>]

OPTIONS:
  --output-config-file  Name of the output config file to use (default: "dobBase.json")
  --tsm-logic           Address of the new logic version (default: "none")

upgradeTokenSaleMarket: Upgrade a token sale market's logic to a new implementation.
```

## estimate deploy costs

```sh
Usage: hardhat [GLOBAL OPTIONS] estimateGasDeployDobBase [--input-config-file <STRING>]

OPTIONS:

  --input-config-file   Name of the input config to use (default: "dob_base.json")

estimateGasDeployDobBase: A task to deploy base contracts for Dob enviroment
```

# Current Working Deploys

## Polygon mainnet

```json
{
  "storage": {
    "address": "0x6D5627e1E4264DD98e2a0973d0db238F318A316F",
    "contract": "EternalStorage",
    "owner": "0x94cB0Ee77B474F43ab571C4Cd79dEC3cb5b8D1c6"
  },
  "poolMaster": {
    "config": {
      "address": "0xEe4E40B137CD783366b80634603D024Fd5008140",
      "contract": "PoolMasterConfig",
      "operational": "0x326C2610E0a97cB5e24a42059e2A2A0E41738b78",
      "regression": {
        "coef": 34813,
        "intercept": 3217412,
        "gasPrice": "100000000000"
      },
      "commission": 300
    },
    "deployer": {
      "address": "0x2260eE1B27a917B9484360ad52de07737B9f22a6",
      "contract": "PoolMaster"
    },
    "owner": "0x6169C8D8070733B3866737089f891Aa0E9e608b0"
  },
  "poolLogic": [
    {
      "address": "0xfEd951ed109A6A468b0026c28cdcAff441E41621",
      "versionNumber": "1"
    }
  ],
  "treasury": {
    "address": "0x1DC93f860Ee30af3C3C65c122482a66f808AA107",
    "ParticipationToken": {
      "address": "0xEBF659B3c6De0104858b1998603c308fD73532F1",
      "name": "DobToken"
    },
    "owner": "0xB23d7b543f814a6E12B4cFc6b221a6826B058dBE",
    "logicVersion": "1"
  },
  "tokenSaleMarket": {
    "address": "0x3E9957cf765BE48bdD4e558a1F093a65187006bf",
    "contract": "LogicProxy",
    "owner": "0x2de047cA4211b28AE2484BC1b9741044C2028261",
    "logic": {
      "address": "0x1BCF6Be35c9Dbd7957613b5572a0dA3283988C16",
      "contract": "TokenSaleMarket"
    },
    "commission": 300
  }
}
```

### CELO Alfajores testnet

```json
{
  "storage": {
    "address": "0xAe481ee203815f0ce2b2b8e47e649625fFc66916",
    "contract": "EternalStorage",
    "owner": "0x5736E3A05b34214c4757fB331682e95fF67cCd5d"
  },
  "poolMaster": {
    "config": {
      "address": "0xDCE0aEa6b2A83e89fA20c19968BbDeF5284cF347",
      "contract": "PoolMasterConfig",
      "operational": "0x06Bf2D512d6422ad7d8B441a39ae1Af80a55545F",
      "regression": {
        "coef": 34813,
        "intercept": 3217412,
        "gasPrice": "5000000000"
      },
      "commission": 300
    },
    "deployer": {
      "address": "0xa6Dc6eb781B51Da94e470a868b71295Cd5609080",
      "contract": "PoolMaster"
    },
    "owner": "0x5736E3A05b34214c4757fB331682e95fF67cCd5d"
  },
  "poolLogic": [
    {
      "address": "0x5263B4EEcfcB0b7eF324E0c755f794Bcf2572615",
      "versionNumber": "1"
    }
  ],
  "treasury": {
    "address": "0x69bA7aAc28c3CAfD22dc0a9Ea0767Ecb8eda98e1",
    "ParticipationToken": {
      "address": "0x79f33891b30aCD710E8b20D660EeB98817f4c222",
      "name": "DobToken"
    },
    "owner": "0x9Da6c74F4B768Ea4422FDBb29ab4905C32C95D74",
    "logicVersion": "1"
  },
  "tokenSaleMarket": [
    {
      "address": "0x29076a1b1Dc5d842152D74569a8d02CBb01170E3",
      "contract": "LogicProxy",
      "owner": "0xc9Be9Aa376D0719Edb751d7f5C163fB04d706e32",
      "logic": {
        "address": "0x35E4A1fA9e5159f6372637F3f03749D7884eD20F",
        "contract": "TokenSaleMarket"
      },
      "commission": 0
    },
    {
      "address": "0x11E7f472537e98aFfFB145dFc47039a6b2aEDCeD",
      "contract": "LogicProxy",
      "owner": "0x2de047cA4211b28AE2484BC1b9741044C2028261",
      "logic": {
        "address": "0xEB3Dfc2379B81A5Fd8dccc2405A3Cc509DfF7Ae2",
        "contract": "TokenSaleMarket"
      },
      "commission": 0,
      "storage": {
        "address": "0x205dc1A980cC1B3b160cC8D57ee95FFed7127C3f",
        "owner": "0x28f6273a228480E1e5e59aBC5d7Ecfb327A15927"
      }
    }
  ]
}
```

### Avalance fuji testnet

```json
{
  "storage": {
    "address": "0x135C1a4271a6FfE85427261185BaE09e10FbbD23",
    "contract": "EternalStorage",
    "owner": "0x28f6273a228480E1e5e59aBC5d7Ecfb327A15927"
  },
  "poolMaster": {
    "config": {
      "address": "0xF7b794d81483C31994d572C296BBf42eF1D1AC47",
      "contract": "PoolMasterConfig",
      "operational": "0x06Bf2D512d6422ad7d8B441a39ae1Af80a55545F",
      "regression": {
        "coef": 34813,
        "intercept": 3217412,
        "gasPrice": "30000000000"
      },
      "commission": 300
    },
    "deployer": {
      "address": "0xf99320758806D2663263Ad9832F6692053d961b7",
      "contract": "PoolMaster"
    },
    "owner": "0x5736E3A05b34214c4757fB331682e95fF67cCd5d"
  },
  "poolLogic": [
    {
      "address": "0x3ca1C441fB6111FacEf4a7558BEB47c49A854e32",
      "versionNumber": "1"
    }
  ],
  "treasury": {
    "address": "0xE1617bb3f17D49449d2faD89aF9bFB0947cd3ab9",
    "ParticipationToken": {
      "address": "0x2Fa48E477F7dCb710789F5e490f52f11C46eE342",
      "name": "DobToken"
    },
    "owner": "0x9Da6c74F4B768Ea4422FDBb29ab4905C32C95D74",
    "logicVersion": "1"
  },
  "tokenSaleMarket": {
    "address": "0x6053B4EcED53C97f373f6271aD21E01418EAE702",
    "contract": "LogicProxy",
    "owner": "0xc9Be9Aa376D0719Edb751d7f5C163fB04d706e32",
    "logic": {
      "address": "0x0EcDC5D3270aB6B462314A23F196d33041cC8837",
      "contract": "TokenSaleMarket"
    },
    "commission": 300
  }
}
```

### Base Mainnet

```json
{
  "storage": {
    "address": "0xc2cda0C615Ac5aA8Cf2Af9B87c3C3c0ec5FefE4b",
    "contract": "EternalStorage",
    "owner": "0x6169C8D8070733B3866737089f891Aa0E9e608b0"
  },
  "poolMaster": {
    "config": {
      "address": "0x0c60E99E6B3C2FCc0E121eCF3cA5b7d74F5D010c",
      "contract": "PoolMasterConfig",
      "operational": "0x326C2610E0a97cB5e24a42059e2A2A0E41738b78",
      "regression": {
        "coef": 34813,
        "intercept": 3217412,
        "gasPrice": "100000000000"
      },
      "commission": 300
    },
    "deployer": {
      "address": "0x1e0E82B5a1D4419f71812fF020a01bc11b022ec8",
      "contract": "PoolMaster"
    },
    "owner": "0x6169C8D8070733B3866737089f891Aa0E9e608b0"
  },
  "poolLogic": [
    {
      "address": "0x12A45381a0c2dF275e76e812a380abDA65255500",
      "versionNumber": "1"
    }
  ],
  "treasury": {
    "address": "0x4A0CD5b4E10fcaf9eC01BD42c730D8114f1157F8",
    "ParticipationToken": {
      "address": "0xcC76048288871825D68d8492cc3B7bafeB53BE83",
      "name": "DobToken"
    },
    "owner": "0xB23d7b543f814a6E12B4cFc6b221a6826B058dBE",
    "logicVersion": "1"
  },
  "tokenSaleMarket": {
    "address": "0xFdf5028D05257234044aBbb43cbA7A1Cc4FB121B",
    "contract": "LogicProxy",
    "owner": "0x2de047cA4211b28AE2484BC1b9741044C2028261",
    "logic": {
      "address": "0xb714d43FF94e8893258Fe704Ed18a2a2f186d592",
      "contract": "TokenSaleMarket"
    },
    "commission": 300
  }
}
```