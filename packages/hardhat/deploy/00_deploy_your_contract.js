// deploy/00_deploy_your_contract.js
const fs = require("fs");
const { config, ethers } = require("hardhat");

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const network = config.defaultNetwork;

  let WETHAddress;

  if (network === "localhost") {
    // local tester receiver address
    const address = "0x555cFBB56A31325de28054AC506898a5539C835f";

    const token1deployment = await deploy(config.tokenContractName,
      {
        from: deployer,
        args: ["TokenA", "AAA", address, ethers.utils.parseUnits("1", 18)],
        log: true,
      }
    );
    const wethDeployment = await deploy(config.wethContractName,
      {
        from: deployer,
        args: [],
        log: true,
      }
    );

    // save the local tokens list
    await saveTokenList(
      await ethers.getContractAt(config.tokenContractName, token1deployment.address),
      await ethers.getContractAt(config.wethContractName, wethDeployment.address),
    );

    // use the newly deployed WETH
    WETHAddress = wethDeployment.address;
  } else {
    // use the weth from config
    WETHAddress = config.networks[config.defaultNetwork].WETHAddress;
  }

  const depployResult = await deploy(config.contractName, {
    // Learn more about args here: https://www.npmjs.com/package/hardhat-deploy#deploymentsdeploy
    from: deployer,
    args: [...config.deployArgs[config.defaultNetwork], WETHAddress],
    log: true,
  });

  /*
    // Getting a previously deployed contract
    const YourContract = await ethers.getContract("YourContract", deployer);
    await YourContract.setPurpose("Hello");

    //const yourContract = await ethers.getContractAt('YourContract', "0xaAC799eC2d00C013f1F11c37E654e59B0429DF6A") //<-- if you want to instantiate a version of a contract at a specific address!
  */

  /*
  //If you want to send value to an address from the deployer
  const deployerWallet = ethers.provider.getSigner()
  await deployerWallet.sendTransaction({
    to: "0x34aA3F359A9D614239015126635CE7732c18fDF3",
    value: ethers.utils.parseEther("0.001")
  })
  */

  /*
  //If you want to send some ETH to a contract on deploy (make your constructor payable!)
  const yourContract = await deploy("YourContract", [], {
  value: ethers.utils.parseEther("0.05")
  });
  */

  /*
  //If you want to link a library into your contract:
  // reference: https://github.com/austintgriffith/scaffold-eth/blob/using-libraries-example/packages/hardhat/scripts/deploy.js#L19
  const yourContract = await deploy("YourContract", [], {}, {
   LibraryName: **LibraryAddress**
  });
  */
};
module.exports.tags = [config.contractName];



async function saveTokenList(...tokensContracts) {
  const tokenListString = JSON.stringify({
    tokens: await Promise.all(tokensContracts.map(
      async (contract) => {
        return {
          "chainId": 31337,
          "address": contract.address,
          "name": await contract.name(),
          "symbol": await contract.symbol(),
          "decimals": await contract.decimals(),
        };
    }))
  }, null, 2);

  // try to mkdir in case it doesn't exist
  try {fs.mkdirSync('./extra/')} catch {};
  fs.writeFileSync('./extra/tokenlist.json', tokenListString);

  console.log(
    " 💾  Saved local token list to: ",
    "packages/hardhat/extra/",
    "\n\n",
    tokenListString);
}
