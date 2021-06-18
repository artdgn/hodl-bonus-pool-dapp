const { ethers, network, config } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");
const { parseUnits } = require("@ethersproject/units");

const { TestUtils: Utils } = require("./utils.js")

const contractName = "HodlPoolV2";
const tokenContractName = "SomeToken";
const feeTokenContractName = "FeeToken";
const wethContractName = "WETH";

use(solidity);

describe(`${contractName} tokens: advanced logic`, function () {

  this.retries(3);  // some time dependant tests are flaky
  this.timeout(4000);  // some tests are slow in isolation (several interactions)
  
  let contract;
  let tokenContract;
  let deployed;
  let deployedToken;
  let owner;
  let addr1;
  let addr2;
  let addrs;

  const minInitialPenaltyPercent = 10;
  const minCommitPeriod = 10;
  const deployArgs = [minInitialPenaltyPercent, minCommitPeriod];

  // fee percent for token with fee
  const tokenFeePercent = 10;

  beforeEach(async () => {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    
    // deploy a token
    tokenContract = await ethers.getContractFactory(tokenContractName);
    deployedToken = await tokenContract.deploy(
      "Token1", "TK1", addr1.address, parseUnits("1", 18));

    // deploy a token with fees on transfer
    feeTokenContract = await ethers.getContractFactory(feeTokenContractName);
    deployedFeeToken = await feeTokenContract.deploy(
      "FeeToken", "FeeTK", addr1.address, parseUnits("1", 18), tokenFeePercent);

    // deploy WETH
    WETHContract = await ethers.getContractFactory(wethContractName);
    deployedWETH = await WETHContract.deploy();

    // deploy contract
    contract = await ethers.getContractFactory(contractName);
    deployed = await contract.deploy(...deployArgs, deployedWETH.address);
  });

  describe("commitment params: first deposit", function () {
    let addr1Caller;
    let addr1TokenCaller;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
      addr1TokenCaller = deployedToken.connect(addr1);
      await addr1TokenCaller.approve(deployed.address, parseUnits("1", 18));
    });

    it("cannot commit to less than minCommitPeriod", async function () {
      expect(
        addr1Caller
        .deposit(
          deployedToken.address, 1000, minInitialPenaltyPercent, minCommitPeriod - 1))
        .to.revertedWith("too short");
    })

    it("cannot commit to more than a year", async function () {
      expect(
        addr1Caller
        .deposit(
          deployedToken.address, 1000, minInitialPenaltyPercent, 366 * 86400))
        .to.revertedWith("too long");
    })

    it("cannot commit to less than minInitialPenaltyPercent", async function () {
      expect(
        addr1Caller
        .deposit(
          deployedToken.address, 1000, minInitialPenaltyPercent - 1, minCommitPeriod))
        .to.revertedWith("too small");
    })

    it("cannot commit to more than 100%", async function () {
      expect(
        addr1Caller
        .deposit(deployedToken.address, 1000, 101, minCommitPeriod))
        .to.revertedWith("100%");
    })

  });

  describe("commitment params: second deposit", function () {
    let addr1Caller;
    let addr1TokenCaller;
    let period1;
    let penalty1;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
      addr1TokenCaller = deployedToken.connect(addr1);
      await addr1TokenCaller.approve(deployed.address, parseUnits("1", 18));        
      // deposit 1
      period1 = 10000;
      penalty1 = 50;
      await addr1Caller.deposit(deployedToken.address, 1000, penalty1, period1);
    });

    it("cannot reduce commitment time immediately", async function () {
      // deposit 2
      expect(addr1Caller.deposit(deployedToken.address, 1000, penalty1, period1 - 2))
        .to.revertedWith("commit period less than");
    });

    it("can reduce commitment time if waited", async function () {
      await Utils.evmIncreaseTime(period1 / 2);  // half commit period
      // should fail
      expect(addr1Caller.deposit(deployedToken.address, 1000, penalty1, (period1 / 2) - 2))
        .to.revertedWith("commit period less than");
      // should succeed
      await addr1Caller.deposit(deployedToken.address, 1000, penalty1, (period1 / 2) - 1);
    });

    it("cannot reduce penalty immediately", async function () {
      // deposit 2
      expect(addr1Caller.deposit(deployedToken.address, 1000, penalty1 - 1, period1))
        .to.revertedWith("penalty percent less than");
    });

    it("can reduce penalty if waited", async function () {
      await Utils.evmIncreaseTime(period1 / 2);  // half commit period
      // should fail
      expect(addr1Caller.deposit(deployedToken.address, 1000, penalty1 / 2 - 1, period1))
        .to.revertedWith("penalty percent less than");
      // should work
      await addr1Caller.deposit(deployedToken.address, 1000, penalty1 / 2, period1);
    });

    it("new penalty cannot be less than minInitialPenaltyPercent", async function () {
      await Utils.evmIncreaseTime(period1 - 2);  // most of the commitment period
      expect(addr1Caller.deposit(deployedToken.address, 1000, 0, period1))
        .to.revertedWith("penalty too small");
    });
  });

  describe("second despoit: points accounting", function () {
    let addr1Caller;
    let addr1TokenCaller;
    let period1;
    let state1;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
      addr1TokenCaller = deployedToken.connect(addr1);
      await addr1TokenCaller.approve(deployed.address, parseUnits("1", 18));        
      // deposit 1
      period1 = 20;
      await addr1Caller.deposit(deployedToken.address, 1000, 50, period1);
      state1 = await Utils.getState(deployed, deployedToken, addr1);
    });

    it("commit points carry over", async function () {
      // wait some time
      await Utils.evmIncreaseTime(period1 / 2);  // half of commit period
      
      // deposit 2
      await addr1Caller.deposit(deployedToken.address, 1000, 50, period1);

      const state2 = await Utils.getState(deployed, deployedToken, addr1);

      // full points = balance * time * penalty / 2
      // first deposit points
      const fullPoints1Only = state1.balance.mul(period1).div(2).div(2);
      // second despoit points (as if new deposit)
      const fullPoints2Only = state2.balance.mul(period1).div(2).div(2);

      // commit points is greater than just full points
      expect(state2.commitPoints).to.gt(fullPoints2Only);

      // difference between actual points and full points
      const carryOver = state2.commitPoints.sub(fullPoints2Only);
      // should be more than 3/4 of the first deposit's points (because of a bit more time)
      expect(carryOver).to.gt(fullPoints1Only.mul(3).div(4));
      expect(carryOver).to.lt(fullPoints1Only);
      // should be close to 3/4
      expect(carryOver).to.be.closeTo(fullPoints1Only.mul(3).div(4), 300);

      // check pool accounting
      expect(state1.totalCommitPoints).to.eq(state1.commitPoints);
      expect(state2.totalCommitPoints).to.eq(state2.commitPoints);
    });

    it("hold points carry over", async function () {
      // wait some time
      await Utils.evmIncreaseTime(period1);  // full commit period
      
      // deposit 2
      await addr1Caller.deposit(deployedToken.address, 1000, 50, period1);

      await Utils.evmIncreaseTime(period1);  // full commit period

      const state2 = await Utils.getState(deployed, deployedToken, addr1);

      // full points = balance * time held
      // first deposit points
      const fullPoints1Only = state1.balance.mul(period1);
      // second despoit (as if new deposit)
      const fullPoints2Only = state2.balance.mul(period1);

      // hold points greater than just full points
      expect(state2.holdPoints).to.gt(fullPoints2Only);

      // difference between actual points and full points
      const carryOver = state2.holdPoints.sub(fullPoints2Only);
      // should be more than the first deposit's points (because of a bit more time)
      expect(carryOver).to.gt(fullPoints1Only);
      expect(carryOver).to.closeTo(fullPoints1Only, 1000); // one second tolerance

      // check pool accounting
      expect(state1.totalHoldPoints).to.eq(state1.holdPoints);
      expect(state2.totalHoldPoints).to.eq(state2.holdPoints);
    });



    
  });

});

