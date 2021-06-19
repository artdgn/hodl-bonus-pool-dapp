const { ethers, network, config } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");
const { parseUnits } = require("@ethersproject/units");

const { TestUtils: Utils } = require("./utils.js")

const contractName = "HodlPoolV2";
const tokenContractName = "SomeToken";
const wethContractName = "WETH";

use(solidity);

describe(`${contractName} tokens: advanced logic`, function () {

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

  describe("multiple deposits: points accounting", function () {
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

    it("new commitment params: commit points", async function () {
      // wait some time
      await Utils.evmIncreaseTime(period1 / 2);  // half of commit period
      
      // deposit 2
      await addr1Caller.deposit(deployedToken.address, 1000, 100, period1 * 2);

      const state2 = await Utils.getState(deployed, deployedToken, addr1);

      // full points = balance * time * penalty / 2
      // first deposit points
      const fullPoints1Only = state1.balance.mul(period1).div(2).div(2);
      // second despoit points (as if new deposit)
      const fullPoints2Only = state2.balance.mul(period1 * 2).div(2);

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

    it("new commitment params: hold points", async function () {
      // wait some time
      await Utils.evmIncreaseTime(period1);  // half of commit period
      
      // deposit 2
      await addr1Caller.deposit(deployedToken.address, 1000, 100, period1 * 2);

      await Utils.evmIncreaseTime(period1 * 2);  // full commit period

      const state2 = await Utils.getState(deployed, deployedToken, addr1);

      // full points = balance * time held
      // first deposit points
      const fullPoints1Only = state1.balance.mul(period1);
      // second despoit (as if new deposit)
      const fullPoints2Only = state2.balance.mul(period1 * 2);

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

  describe("single account: bonus points accounting with time", function () {
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
  
    it("single deposit: hold points increase, commit points constant", async function () {
      // immediately hold points 0
      expect(state1.holdPoints).to.eq(0);
      expect(state1.commitPoints).to.eq(state1.balance.mul(period1).div(4));

      // wait some time
      await Utils.evmIncreaseTime(period1); 
      const state2 = await Utils.getState(deployed, deployedToken, addr1);

      expect(state2.holdPoints).to.eq(state2.balance.mul(period1));
      expect(state2.commitPoints).to.eq(state1.commitPoints);

      // wait some more
      await Utils.evmIncreaseTime(period1 * 10);
      const state3 = await Utils.getState(deployed, deployedToken, addr1);

      expect(state3.holdPoints).to.eq(state2.balance.mul(period1 * 11));
      expect(state3.commitPoints).to.eq(state2.commitPoints);
    });

  });

  describe("multiple accounts: bonus points accounting with time", function () {
    let addr1Caller;
    let addr2Caller;
    let addr1TokenCaller;
    let addr2TokenCaller;
    let period1;
    let state1;
    let state2;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
      addr2Caller = deployed.connect(addr2);
      addr1TokenCaller = deployedToken.connect(addr1);
      addr2TokenCaller = deployedToken.connect(addr2);
      // give 2 some tokens
      addr1TokenCaller.transfer(addr2.address, parseUnits("0.5", 18))
      await addr1TokenCaller.approve(deployed.address, parseUnits("0.5", 18));        
      await addr2TokenCaller.approve(deployed.address, parseUnits("0.5", 18));        
      // deposit and withdraw to have bonus in the pool
      period1 = 20;
      // tweak the deposit to have penalty of 1000 exactly for easy calc
      await addr1Caller.deposit(deployedToken.address, 1001, 100, 365 * 86400);
      await addr1Caller.withdrawWithPenalty(deployedToken.address);
      // deposit and hold
      await addr1Caller.deposit(deployedToken.address, 1000, 50, period1);
      state1 = await Utils.getState(deployed, deployedToken, addr1);      
    });

    it("bonus division", async function () {
      // wait for 9 times the period to acrue hold bonus
      await Utils.evmIncreaseTime(period1 * 9 - 1); 
      // deposit for 2: 10 times the deposit to get more commit bonus
      await addr2Caller.deposit(deployedToken.address, 1000 * 10, 50, period1);      
      // wait some more times the period to actue hold bonus
      await Utils.evmIncreaseTime(period1); 
      state1 = await Utils.getState(deployed, deployedToken, addr1);
      state2 = await Utils.getState(deployed, deployedToken, addr2);

      // hold points are equal because of more tokens held for shorter period
      expect(state1.holdPoints).to.eq(state2.holdPoints);      
      // 1000 divided by 2 into two pools
      expect(state1.holdBonusesSum).to.eq(500);
      // deserves half the bonus
      expect(state1.holdBonus).to.eq(250);
      // bonus is equal (proportional to points)
      expect(state1.holdBonus).to.eq(state2.holdBonus);

      // commit points are 10 times higher
      expect(state1.commitPoints).to.eq(state2.commitPoints.div(10));
      // bonus division
      expect(state1.commitBonus).to.eq(state2.commitBonus.div(10));
      // 1000 divided by 2 into two pools
      expect(state1.commitBonusesSum).to.eq(500);
      // deserves 10 times the bonus
      expect(state1.commitBonus).to.eq(45);  // 45.4 rounded down
      expect(state2.commitBonus).to.eq(454);  // 454.5 rounded down

      // withdraw 2 first to check rounding
      const withdrawal2 = await Utils.callCaptureEventAndBalanceToken(
        addr2.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () => await addr2Caller.withdrawWithBonus(deployedToken.address)
      );
      const withdrawal1 = await Utils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () => await addr1Caller.withdrawWithBonus(deployedToken.address)
      );

      // check that withdrawals results in expected numbers
      // closeTo is due to time passing between calls and changing hold points
      expect(withdrawal1.delta).to.closeTo(
        state1.balance.add(state1.holdBonus).add(state1.commitBonus), 15);
      expect(withdrawal2.delta).to.closeTo(
        state2.balance.add(state2.holdBonus).add(state2.commitBonus), 15);

      // check withdrawed everything deposit 2 + deposit 1 + all the bonus
      expect(withdrawal2.delta.add(withdrawal1.delta)).to.eq(1000 * 10 + 1000 + 1000);

      const state3 = await Utils.getState(deployed, deployedToken, addr1);
      // check all pools and points are zero
      expect(state3.totalCommitPoints).to.eq(0);
      expect(state3.totalHoldPoints).to.eq(0);
      expect(state3.holdBonusesSum).to.eq(0);
      expect(state3.commitBonusesSum).to.eq(0);      
      expect(state3.depositsSum).to.eq(0);      
    });

    it("micro deposit not rounded down when left last", async function () {
      // wait for 9 times the period to acrue hold bonus
      await Utils.evmIncreaseTime(period1 * 9 - 1); 

      // deposit for 2: 1 wei (of token)
      await addr2Caller.deposit(deployedToken.address, 1, 50, period1);      

      // wait until withdrawal with bonus possible
      await Utils.evmIncreaseTime(period1); 

      state1 = await Utils.getState(deployed, deployedToken, addr1);
      state2 = await Utils.getState(deployed, deployedToken, addr2);

      // withdraw the bigger deposit first
      await addr1Caller.withdrawWithBonus(deployedToken.address);

      // withdraw the small deposit
      const withdrawal2 = await Utils.callCaptureEventAndBalanceToken(
        addr2.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () => await addr2Caller.withdrawWithBonus(deployedToken.address)
      );

      expect(withdrawal2.lastEvent.commitBonus).to.eq(1);
      expect(withdrawal2.lastEvent.holdBonus).to.eq(1);
      // 1 wei for each of: deposit, hold bonus, commit bonus
      expect(withdrawal2.delta).to.eq(3);  
    });
    
  });

});

