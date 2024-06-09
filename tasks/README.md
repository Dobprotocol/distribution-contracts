# Hardhat tasks

There are several configured tasks usefull for development, deployment and debuging of Dob contracts. these tasks are:

* `addressDistributionBalance`: check the current distributed ballance to a target address in an specific pool
* `deployDobBase`: deploys the core contracts for our Dob platform
* `deployNewLogic`: Deploys new pool logic versions and link it to our Pool Master
* `deploySimulationPools`: Deploys simulation pools on an specific deployment of Dob
* `depositFunds`: Deposit funds to an specific pool
* `gasExperiment`: Execute the experiment of distribute with many different pools considering a different number of participant. Used to generate the linear regression to estimate the gas used. This tasks produces a JSON file with the resulting data.
* `upgradePool`: perform the logic upgrade of a pool following the UUPS proxy pattern
* `upgradePoolMaster`: perfom the logic upgrade of a pool master following the UUPS proxy pattern


## DEPLOY DOB

To deploy dob main contracts use the task `deployDobBase` with arguments:

```
hardhat [GLOBAL OPTIONS] deployDobBase [--input-config-file <STRING>] [--output-config-tag <STRING>]
```

### OPTIONS:

* `--input-config-file`: the configuration file for the new deploy, must be stored in `tasks/configs/`
* `--output-config-tag`: a tag used to name the output file with all the relevant data of the deploy. It will be generated in folder `tasks/deploys` using the name structure `output_YYYY-mm-ddtHH:MM:SS.sssZ_{tag}.json`
