const { ethers, network, config } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");
const { parseUnits } = require("@ethersproject/units");

const { TestUtils: Utils } = require("./utils.js")

const contractName = "HodlPoolV3";
const tokenContractName = "SomeToken";
const wethContractName = "WETH";

use(solidity);

describe(`${contractName} deposits: access control`, function () {

  this.retries(3);  // some time dependant tests are flaky
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

  describe("single deposit access", function () {
    let addr1Caller;
    let addr2Caller;
    let addr1TokenCaller;
    let state1;
    let dep1;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);      
      addr1TokenCaller = deployedToken.connect(addr1);
      await addr1TokenCaller.approve(deployed.address, parseUnits("1", 18));        
      await addr1Caller.deposit(deployedToken.address, 1000, 50, 20);
      dep1 = (await Utils.lastDepositEvent(deployed)).tokenId;
      state1 = await Utils.getState(deployed, deployedToken, dep1);
      // second caller
      addr2Caller = deployed.connect(addr2);
    });

    it("owner can transfer", async function () {
      await addr1Caller.transferFrom(addr1.address, addr2.address, dep1);
    });

    it("non-owner cannot transfer", async function () {
      expect(
        addr2Caller
        .transferFrom(addr1.address, addr2.address, dep1))
        .to.revertedWith("not owner nor approved");
    });

    it("non-owner cannot withdraw", async function () {
      expect(
        addr2Caller
        .withdrawWithPenalty(dep1))
        .to.revertedWith("not deposit owner");
    });

    it("non-owner cannot withdraw even if approved for transfer", async function () {
      await addr1Caller.approve(addr2.address, dep1);
      await addr1Caller.setApprovalForAll(addr2.address, true);
      expect(
        addr2Caller.withdrawWithPenalty(dep1)).to.revertedWith("not deposit owner");
    });

    it("non-owner can transfer if approved, then withdraw", async function () {
      await addr1Caller.approve(addr2.address, dep1);
      await addr2Caller.transferFrom(addr1.address, addr2.address, dep1);
      // can withdraw
      await addr2Caller.withdrawWithPenalty(dep1);
    });

    it("cannot withdraw after transfer ownership 1", async function () {
      await addr1Caller.approve(addr2.address, dep1);
      await addr2Caller.transferFrom(addr1.address, addr2.address, dep1);
      // first owner cannot withdraw
      expect(
        addr1Caller.withdrawWithPenalty(dep1)).to.revertedWith("not deposit owner");
    });

    it("cannot withdraw after transfer ownership 2", async function () {
      await addr1Caller.transferFrom(addr1.address, addr2.address, dep1);
      // first owner cannot withdraw
      expect(
        addr1Caller.withdrawWithPenalty(dep1)).to.revertedWith("not deposit owner");
    });

  });

  describe("deposit for other account", function () {
    let addr1Caller;
    let addr2Caller;
    let addr1TokenCaller;
    let state1;
    let dep1;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);      
      addr1TokenCaller = deployedToken.connect(addr1);
      await addr1TokenCaller.approve(deployed.address, parseUnits("1", 18));
      addr2Caller = deployed.connect(addr2);
    });

    it("depositFor withdrawals", async function () {
      await addr1Caller.depositFor(addr2.address, deployedToken.address, 1000, 50, 20);
      dep1 = (await Utils.lastDepositEvent(deployed)).tokenId;
      // depositor can't withdraw
      expect(
        addr1Caller.withdrawWithPenalty(dep1)).to.revertedWith("not deposit owner");      
      state1 = await Utils.getState(deployed, deployedToken, dep1);
      expect(state1.account).to.eq(addr2.address);      
      // new owner can withdraw
      await addr2Caller.withdrawWithPenalty(dep1);
    });

    it("depositETHFor withdrawals", async function () {
      await addr1Caller.depositETHFor(addr2.address, 50, 20, { value: 1000 });
      dep1 = (await Utils.lastDepositEvent(deployed)).tokenId;
      // depositor can't withdraw
      expect(
        addr1Caller.withdrawWithPenaltyETH(dep1)).to.revertedWith("not deposit owner");      
      state1 = await Utils.getState(deployed, deployedWETH, dep1);
      expect(state1.account).to.eq(addr2.address);      
      // new owner can withdraw
      await addr2Caller.withdrawWithPenaltyETH(dep1);
    });

  });

  describe("mixing ETH and token methods", function () {
    let addr1Caller;
    let addr1TokenCaller;
    let state1;
    let dep1;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);      
      addr1TokenCaller = deployedToken.connect(addr1);
      await addr1TokenCaller.approve(deployed.address, parseUnits("1", 18));        
      // deposit 1
      await addr1Caller.deposit(deployedToken.address, 1000, 50, 20);
      dep1 = (await Utils.lastDepositEvent(deployed)).tokenId;
      state1 = await Utils.getState(deployed, deployedToken, dep1);
    });

    it("cannot use ETH methods for token deposit", async function () {
      expect(
        addr1Caller.withdrawWithPenaltyETH(dep1)).to.revertedWith("not an ETH / WETH");
      // token withdrawal works
      await addr1Caller.withdrawWithPenalty(dep1);
    });

    it("can withdraw ETH deposit as WETH", async function () {
      const value = 1000;
      await addr1Caller.depositETH(50, 20, { value: value });
      depETH = (await Utils.lastDepositEvent(deployed)).tokenId;
      const withdrawal = await Utils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedWETH,
        async () => await addr1Caller.withdrawWithPenalty(depETH)
      );
      expect(withdrawal.delta).to.gt(0);
      // cannot withdraw as ETH after that
      expect(
        addr1Caller.withdrawWithPenaltyETH(depETH)).to.revertedWith("nonexistent");
    });

    it("can withdraw WETH deposit as ETH", async function () {
      const value = 1000;
      // deposit some ETH into WETH
      const addr1WETHCaller = deployedWETH.connect(addr1);
      await addr1WETHCaller.deposit({value: value});
      // approve contract
      await addr1WETHCaller.approve(deployed.address, value);
      // deposit to contract
      await addr1Caller.deposit(deployedWETH.address, value, 50, 20);
      depWETH = (await Utils.lastDepositEvent(deployed)).tokenId;
      const withdrawal = await Utils.callCaptureEventAndBalanceETH(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        async () => await addr1Caller.withdrawWithPenaltyETH(depWETH, { gasPrice: 0 })
      );
      expect(withdrawal.delta).to.gt(0);
      // cannot withdraw as ETH after that
      expect(
        addr1Caller.withdrawWithPenalty(depWETH)).to.revertedWith("nonexistent");
    });
  
  });

  describe("sending to contract", function () {
    let addr1Caller;
    let addr2Caller;
    let addr1TokenCaller;
    let addr2TokenCaller;
    let state1;
    let dep1;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);      
      addr1TokenCaller = deployedToken.connect(addr1);
      addr2Caller = deployed.connect(addr2);      
      addr2TokenCaller = deployedToken.connect(addr2);
      // give 2 some tokens
      await addr1TokenCaller.transfer(addr2.address, 1000);
      // deposit 1
      await addr1TokenCaller.approve(deployed.address, 1000);        
      await addr1Caller.deposit(deployedToken.address, 1000, 50, minCommitPeriod);
      dep1 = (await Utils.lastDepositEvent(deployed)).tokenId;      
    });

    it("sending tokens to contract adds them to deposits pool", async function () {
      // 2 sends tokens directly to contract
      await addr2TokenCaller.transfer(deployed.address, 1000);
      // wait to be able to withdraw bonus
      await Utils.evmIncreaseTime(minCommitPeriod); 
      // get deposit state
      state1 = await Utils.getState(deployed, deployedToken, dep1);
      
      const withdrawal = await Utils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () => await addr1Caller.withdrawWithBonus(dep1)
      );
      expect(state1.balance).to.eq(1000 + 1000);
      expect(withdrawal.delta).to.eq(1000 + 1000);  // deposit + accidental send (bonus pool)
    });

    it("sending ETH to contract reverts", async function () {      
      expect(
        addr2.sendTransaction({ to: deployed.address, value: 1000 }))
        .to.revertedWith("no receive()");
    });
  
  });

});

