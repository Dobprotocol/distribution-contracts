import { task } from "hardhat/config";
import fs from 'fs';
import * as path from 'path';
import { checkCreatorAddress } from "../../utils/deploy-utils";
import "../subtasks/deployStorage";
import "../subtasks/deployLogic";
import "../subtasks/deployPoolMaster";
import "../subtasks/deployTokenSaleMarket";
import "../subtasks/deployTreasuryPool";
import "../subtasks/transferOnwership";

task("deployDobBase", "A task to deploy base contracts for Dob enviroment")
    .addPositionalParam("configFile", "Path to the config file to use for the deploy")
    .addOptionalParam("outputFile", "Path to the output config file. By default uses tasks/outputs/deployDobBase/output_<datetime>.json", "")
    .addOptionalParam("estimateOnly", "if enabled, it will only estimate the deployment cost", "false")
    .setAction(async (taskArgs, hre) =>{
        const now = new Date();
        const NAME = "deployDobBase"
        const defaultOutputFolder = path.join(path.dirname(path.dirname(__dirname)), "outputs", NAME)
        console.log("defaultOutputFolder ->", defaultOutputFolder)

        // check config file
        if (!fs.existsSync(taskArgs.configFile)){
            throw new Error("config file does not exist")
        }

        // if estimate_only enabled, call that trask
        if (taskArgs.estimateOnly === "true"){
            await hre.run("estimateGasDeployDobBase", {configFile: taskArgs.configFile})
            return
        }// else, proceed


        // check output file
        let outputFile;
        if (taskArgs.outputFile === ""){
            outputFile=path.join(defaultOutputFolder, `output_${now.toISOString()}.json`);
        } else {
            outputFile = taskArgs.outputFile;
        }

        // check if output folder exists, if not, create
        if (!fs.existsSync(path.dirname(outputFile))){
            console.log("creating", path.dirname(outputFile))
            fs.mkdirSync(path.dirname(outputFile), {recursive: true});
        }

        // check creator address
        let inData = JSON.parse(fs.readFileSync(
            path.join(taskArgs.configFile), 'utf8'));
        const accounts = await hre.ethers.getSigners();
        if (!checkCreatorAddress(accounts,inData)){
            console.log("trowing error")
            throw new Error("creator address does not match")
        }

        // if outputfile exists, open it
        let outData = {}
        if (fs.existsSync(outputFile)){
            outData = JSON.parse(fs.readFileSync(outputFile, 'utf8'))
        }

        console.log("::::::::::::::::::::::::::::::::::::")
        console.log(`:::: Deploying to ${outputFile} ::::`)
        console.log("::::::::::::::::::::::::::::::::::::")

        // prepar inputs and call sub-tasks
        let argFiles = {
            "outputConfigFile": outputFile,
            "inputConfigFile": taskArgs.configFile
        }
        if ("storage" in outData){
            console.log("SKIP: storage already deployed")
        } else {
            await hre.run("deployStorage", argFiles)
        }
        await new Promise(f => setTimeout(f, 1000));
        if ("poolMaster" in outData){
            console.log("SKIP: pool master already deployed")
        } else {
            await hre.run("deployPoolMaster", argFiles)
        }
        await new Promise(f => setTimeout(f, 1000));
        if ("poolLogic" in outData){
            console.log("SKIP: pool logic already deployed")
        } else {
            await hre.run("deployLogic", argFiles)
        }
        await new Promise(f => setTimeout(f, 1000));
        if ("treasury" in outData){
            console.log("SKIP: treasury pool already deployed")
        } else {
            await hre.run("deployTreasuryPool", argFiles) 
        }
        await new Promise(f => setTimeout(f, 1000));
        if ("tokenSaleMarket" in outData){
            console.log("SKIP: token sale market already deployed")
        } else {
            await hre.run("deployTokenSaleMarket", argFiles)
        }
        await new Promise(f => setTimeout(f, 1000));
        await hre.run("transferOwnership", argFiles)

        console.log("::::::::::::::::::::::::::::::::::::")
        console.log(`:::: Deploy saved to file ${outputFile} ::::`)
        console.log("::::::::::::::::::::::::::::::::::::")
    })