const { ethers, network, config } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");
const { parseUnits } = require("@ethersproject/units");

const { TestUtils: Utils } = require("./utils.js")

const contractName = "HodlPoolV3";
const tokenContractName = "SomeToken";
const wethContractName = "WETH";

use(solidity);

describe(`${contractName} views and metadata`, function () {

  this.timeout(4000);  // some tests are slow in isolation (several interactions)

  let contract;
  let tokenContract;
  let WETHContract;
  let deployed;
  let deployedToken;
  let deployedWETH;
  let owner;
  let addr1;
  let addr2;
  let addrs;

  const minInitialPenaltyPercent = 10;
  const minCommitPeriod = 10;
  const deployArgs = [minInitialPenaltyPercent, minCommitPeriod];

  beforeEach(async () => {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    // deploy a token
    tokenContract = await ethers.getContractFactory(tokenContractName);
    deployedToken = await tokenContract.deploy(
      "Token1", "TK1", addr1.address, parseUnits("1", 18));

    // deploy WETH
    WETHContract = await ethers.getContractFactory(wethContractName);
    deployedWETH = await WETHContract.deploy();

    // deploy contract
    contract = await ethers.getContractFactory(contractName);
    deployed = await contract.deploy(...deployArgs, deployedWETH.address);
  });

  describe("ERC721 tokenURI", function () {
    let addr1Caller;
    let addr1TokenCaller;
    let dep1;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
      addr1TokenCaller = deployedToken.connect(addr1);
      await addr1TokenCaller.approve(deployed.address, parseUnits("1", 18));
      await addr1Caller.deposit(deployedToken.address, 1000, 50, 20);
      dep1 = (await Utils.lastDepositEvent(deployed)).tokenId;
    });

    it("nonexitent deposit", async function () {
      expect(deployed.tokenURI(0)).to.revertedWith("nonexistent");
    });

    it("existing deposit", async function () {
      const metadata = JSON.parse(await deployed.tokenURI(dep1));
      // name contains id
      expect(metadata.name).to.contain(dep1.toString());
      // description contains token address
      expect(
        metadata.description.toLowerCase()).to.contain(
          deployedToken.address.toLowerCase());
      // console.log(metadata);
    });
  
  });

  describe("poolDetails", function () {
    it("poolDetails works for any address", async function () {
      // no sush asset
      const res = await deployed.poolDetails(addr2.address);
      res.forEach((v) => expect(v).to.eq(0));
    });
  });

  describe("depositDetails", function () {
    it("depositDetails works for any tokenId", async function () {
      // no such tokenId
      const res = await deployed.depositDetails(42);
      res.forEach((v) => expect(v).to.eq(0));
    });
  });

  describe("depositsOfOwner", function () {
    it("depositsOfOwner works for any account", async function () {
      // no deposits
      const res = await deployed.depositsOfOwner(addr2.address);
      expect(res.tokenIds.length).to.eq(0);
      expect(res.accountDeposits.length).to.eq(0);
    });
  });
  
});

