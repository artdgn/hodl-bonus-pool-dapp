const { ethers, network, config } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

const { TestUtils } = require("./utils.js")

const contractName = "HodlPoolV3";
const tokenContractName = "SomeToken";
const wethContractName = "WETH";
const utils = ethers.utils;

use(solidity);

describe(`${contractName} tokens: basic logic`, function () {

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

  const minInitialPenaltyPercent = 100;
  const minCommitPeriod = 10;
  const deployArgs = [minInitialPenaltyPercent, minCommitPeriod];


  beforeEach(async () => {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    
    // deploy a token
    tokenContract = await ethers.getContractFactory(tokenContractName);
    deployedToken = await tokenContract.deploy(
      "Token1", "TK1", addr1.address, utils.parseUnits("1", 18));

    // deploy WETH
    WETHContract = await ethers.getContractFactory(wethContractName);
    deployedWETH = await WETHContract.deploy();

    // deploy contract
    contract = await ethers.getContractFactory(contractName);
    deployed = await contract.deploy(...deployArgs, deployedWETH.address);
  });

  describe("tokens: single account deposits & withdrawals", function () {
    let addr1Caller;
    let addr1TokenCaller;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
      addr1TokenCaller = deployedToken.connect(addr1);
    });

    it("fails on non-token address", async function () {
      expect(
        addr1Caller
        .deposit(ethers.constants.AddressZero, 1000, minInitialPenaltyPercent, minCommitPeriod))
        .to.reverted;
    });

    it("can't deposit more than token balance", async function () {
      expect(
        addr1Caller
        .deposit(deployedToken.address, utils.parseUnits("1.001", 18), minInitialPenaltyPercent, minCommitPeriod))
        .to.revertedWith("exceeds balance");
    })

    it("can't deposit without allowance", async function () {
      expect(
        addr1Caller
        .deposit(deployedToken.address, utils.parseUnits("0.001", 18), minInitialPenaltyPercent, minCommitPeriod))
        .to.revertedWith("exceeds allowance");
    })

    it("can't deposit 0", async function () {
      expect(addr1Caller
        .deposit(deployedToken.address, 0, minInitialPenaltyPercent, minCommitPeriod))
        .to.revertedWith("empty deposit");
    })

    it("can't withdrawWithBonus if didn't deposit", async function () {
      expect(addr1Caller.withdrawWithBonus(0))
        .to.revertedWith("nonexistent");
    });

    it("can't withdrawWithPenalty if didn't deposit", async function () {
      expect(addr1Caller.withdrawWithPenalty(0))
        .to.revertedWith("nonexistent");
    });

    it("can deposit twice", async function () {
      const tx = 1000;
      // approve tokens
      await addr1TokenCaller.approve(deployed.address, tx * 2);

      // make the calls
      const depositTwice = await TestUtils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Deposited()), 
        deployedToken,
        async () => {
          await expect(addr1Caller
            .deposit(deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod))
            .to.emit(deployed, "Deposited");
          await expect(addr1Caller
            .deposit(deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod))
            .to.emit(deployed, "Deposited");
        }
      );
      
      const blockTimestamp = (await ethers.provider.getBlock()).timestamp;
      const numDeposits = await deployed.balanceOf(addr1.address);
      const dep1 = await deployed.tokenOfOwnerByIndex(addr1.address, 0);
      const dep2 = await deployed.tokenOfOwnerByIndex(addr1.address, 1);

      expect(numDeposits).to.equal(2);

      const deposits = await deployed.depositsOfOwner(addr1.address);

      // check deposits
      expect(deposits.tokenIds.length).to.equal(2)
      expect(deposits.tokenIds[0]).to.equal(dep1)
      expect(deposits.accountDeposits[0].asset).to.equal(deployedToken.address);
      expect(deposits.accountDeposits[0].amount).to.equal(tx);
      expect(deposits.tokenIds[1]).to.equal(dep2)
      expect(deposits.accountDeposits[1].asset).to.equal(deployedToken.address);
      expect(deposits.accountDeposits[1].amount).to.equal(tx);
      
      // check deposit details
      const expectedSum = tx * 2;
      const state1 = await TestUtils.getState(deployed, deployedToken, dep1);
      const state2 = await TestUtils.getState(deployed, deployedToken, dep2);
      // check balance
      expect(state1.balance.add(state2.balance)).to.equal(expectedSum);
      // check depositsSum
      expect(state1.depositsSum).to.equal(expectedSum);
      // check contract token balance
      expect(await deployedToken.balanceOf(deployed.address)).to.equal(expectedSum);
      // check event
      expect(depositTwice.lastEvent.account).to.equal(addr1.address);
      expect(depositTwice.lastEvent.amount).to.equal(tx);
      expect(depositTwice.lastEvent.time).to.equal(blockTimestamp);
    });

    it("can deposit different tokens", async function () {
      // deploy second token
      tokenContract2 = await ethers.getContractFactory(tokenContractName);
      deployedToken2 = await tokenContract2.deploy(
        "Token2", "TK2", addr1.address, utils.parseUnits("2", 18));
      addr1Token2Caller = deployedToken2.connect(addr1);

      const tx = 1000;
      // approve tokens
      await addr1TokenCaller.approve(deployed.address, tx);
      await addr1Token2Caller.approve(deployed.address, tx);

      // make deposits
      await addr1Caller.deposit(
        deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      const dep1 = (await TestUtils.lastDepositEvent(deployed)).tokenId;

      await addr1Caller.deposit(
        deployedToken2.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      const dep2 = (await TestUtils.lastDepositEvent(deployed)).tokenId;


      const state1 = await TestUtils.getState(deployed, deployedToken, dep1);
      const state2 = await TestUtils.getState(deployed, deployedToken2, dep2);

      // check balance
      expect(state1.balance).to.equal(tx);
      expect(state1.asset).to.equal(deployedToken.address);
      expect(state2.balance).to.equal(tx);
      expect(state2.asset).to.equal(deployedToken2.address);

      // check depositsSum
      expect(state1.depositsSum).to.equal(tx);
      expect(state2.depositsSum).to.equal(tx);

      // check contract token balance
      expect(await deployedToken.balanceOf(deployed.address)).to.equal(tx);
      expect(await deployedToken2.balanceOf(deployed.address)).to.equal(tx);      
    });

    it("smaller initial penalty accounting", async function () {
      const penaltyPercent = 10
      deployed = await contract.deploy(penaltyPercent, minCommitPeriod, deployedWETH.address);
      addr1Caller = deployed.connect(addr1);
      const dep = 1000;
      await addr1TokenCaller.approve(deployed.address, dep);
      await addr1Caller.deposit(
        deployedToken.address, dep, penaltyPercent, minCommitPeriod);
      const dep1 = (await TestUtils.lastDepositEvent(deployed)).tokenId;

      // should be full penalty
      expect(
        (await TestUtils.getState(deployed, deployedToken, dep1)).penalty)
        .to.equal(dep * penaltyPercent / 100);

      // back to the future to 50% time
      await TestUtils.evmIncreaseTime(minCommitPeriod / 2)
      expect(
        (await TestUtils.getState(deployed, deployedToken, dep1)).penalty)
        .to.equal(dep * penaltyPercent / (2 * 100));
      
      // back to the future to 100% time
      await TestUtils.evmIncreaseTime(minCommitPeriod / 2)
      expect(
        (await TestUtils.getState(deployed, deployedToken, dep1)).penalty)
        .to.equal(0);
    });

    it("penaltyOf & withdrawWithBonus & timeLeftToHoldOf with time passage", 
      async function () 
    {
      const dep = 1000;
      await addr1TokenCaller.approve(deployed.address, dep);
      await addr1Caller.deposit(
        deployedToken.address, dep, minInitialPenaltyPercent, minCommitPeriod);
      const dep1 = (await TestUtils.lastDepositEvent(deployed)).tokenId;
      const state0 = await TestUtils.getState(deployed, deployedToken, dep1);
      const depositBalance = state0.balance;

      // should be full penalty
      const state1 = await TestUtils.getState(deployed, deployedToken, dep1);
      expect(state1.penalty).to.equal(depositBalance);
      // should need to wait full commit period
      expect(state1.timeLeftToHold).to.equal(minCommitPeriod);

      // back to the future to 50% time
      await TestUtils.evmIncreaseTime(minCommitPeriod / 2);
      const state2 = await TestUtils.getState(deployed, deployedToken, dep1);
      expect(state2.penalty).to.equal(depositBalance / 2);
      // only half the time left to wait
      expect(state2.timeLeftToHold).to.equal(minCommitPeriod / 2);

      // try to withdraw without penalty and fail
      await expect(addr1Caller.withdrawWithBonus(dep1))
        .to.revertedWith("penalty");
      
      // back to the future to 100% time
      await TestUtils.evmIncreaseTime(minCommitPeriod / 2);
      const state3 = await TestUtils.getState(deployed, deployedToken, dep1);
      expect(state3.penalty).to.equal(0);
      // no need to wait any longer
      expect(state3.timeLeftToHold).to.equal(0);

      const withdrawal = await TestUtils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () => {
          await expect(addr1Caller.withdrawWithBonus(dep1))
            .to.emit(deployed, "Withdrawed");
        }
      );
      
      // should be able to withdraw without penalty now
      expect(withdrawal.delta).to.equal(depositBalance);

      expect(withdrawal.lastEvent.account).to.equal(addr1.address);
      expect(withdrawal.lastEvent.amount).to.equal(depositBalance);
      expect(withdrawal.lastEvent.penalty).to.equal(0);
      expect(withdrawal.lastEvent.holdBonus).to.equal(0);
      expect(withdrawal.lastEvent.commitBonus).to.equal(0);
      expect(withdrawal.lastEvent.timeHeld).to.gt(minCommitPeriod);

      // check can't withdraw any more
      expect(addr1Caller.withdrawWithPenalty(dep1)).to.revertedWith("nonexistent");
    });

    it("withdrawWithPenalty before commit period end", async function () {
      const tx = 1000;
      await addr1TokenCaller.approve(deployed.address, tx);
      await addr1Caller.deposit(
        deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      const dep1 = (await TestUtils.lastDepositEvent(deployed)).tokenId;

      // back to the future to 50% time
      await TestUtils.evmIncreaseTime((minCommitPeriod / 2) - 1);  // write transaction will add some time

      const withdrawal = await TestUtils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () => {
          await expect(addr1Caller.withdrawWithPenalty(dep1))
            .to.emit(deployed, "Withdrawed");
        }
      );

      // should be able to withdraw half now
      expect(withdrawal.delta).to.equal(tx / 2);

      // check event
      expect(withdrawal.lastEvent.account).to.equal(addr1.address);
      expect(withdrawal.lastEvent.amount).to.equal(tx / 2);
      expect(withdrawal.lastEvent.penalty).to.equal(tx / 2);
      expect(withdrawal.lastEvent.holdBonus).to.equal(0);
      expect(withdrawal.lastEvent.commitBonus).to.equal(0);
      expect(withdrawal.lastEvent.timeHeld).to.equal(minCommitPeriod / 2);

      // check can't withdraw any more
      expect(addr1Caller.withdrawWithPenalty(deployedToken.address))
        .to.revertedWith("nonexistent");
    });
    
  });

  describe("tokens: two accounts bonus behavior", function () {
    let addr1Caller;
    let addr2Caller;
    let addr1TokenCaller;
    let addr2TokenCaller;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
      addr1TokenCaller = deployedToken.connect(addr1);
      addr2Caller = deployed.connect(addr2);
      addr2TokenCaller = deployedToken.connect(addr2);
    });

    it("1 penalty 1 bonus", async function () {
      const tx1 = 1000;
      const tx2 = 2000;
      await addr1TokenCaller.approve(deployed.address, tx1);
      await addr1TokenCaller.transfer(addr2.address, tx2);
      await addr1Caller.deposit(
        deployedToken.address, tx1, minInitialPenaltyPercent, minCommitPeriod);
      const dep1 = (await TestUtils.lastDepositEvent(deployed)).tokenId;
      await addr2TokenCaller.approve(deployed.address, tx2);
      await addr2Caller.deposit(
        deployedToken.address, tx2, minInitialPenaltyPercent, minCommitPeriod);
      const dep2 = (await TestUtils.lastDepositEvent(deployed)).tokenId;

      // no bunus initially
      expect((await TestUtils.getState(deployed, deployedToken, dep1)).holdBonus).to.equal(0);
      expect((await TestUtils.getState(deployed, deployedToken, dep1)).commitBonus).to.equal(0);
      expect((await TestUtils.getState(deployed, deployedToken, dep2)).holdBonus).to.equal(0);
      expect((await TestUtils.getState(deployed, deployedToken, dep2)).commitBonus).to.equal(0);
      // check depositsSum
      expect((await TestUtils.getState(deployed, deployedToken, dep1)).depositsSum).to.equal(tx1 + tx2);

      // withdraw with penalty
      const withdrawal1 = await TestUtils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () =>  await addr1Caller.withdrawWithPenalty(dep1)
      );
      
      // check penalty was non-0
      const penalty1 = ethers.BigNumber.from(tx1).sub(withdrawal1.delta);
      expect(penalty1).to.gt(0);

      // check bonus of 2 is penalty of 1
      const state2 = await TestUtils.getState(deployed, deployedToken, dep2);
      expect(state2.holdBonus.add(state2.commitBonus))
        .to.equal(penalty1);
      expect(state2.holdBonusesSum.add(state2.commitBonusesSum)).to.equal(penalty1);

      // check 2 can't withdraw with bonus too soon
      await expect(addr2Caller.withdrawWithBonus(dep2))
        .to.revertedWith("penalty");

      // move time
      await TestUtils.evmIncreaseTime(minCommitPeriod);  

      // withdraw bonus
      const withdrawal2 = await TestUtils.callCaptureEventAndBalanceToken(
        addr2.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () =>  await addr2Caller.withdrawWithBonus(dep2)
      );

      const bonus2 = ethers.BigNumber.from(withdrawal2.delta).sub(tx2);
      // check withdrawal of correct bonus amount
      expect(bonus2).to.equal(penalty1);

      // check event
      expect(withdrawal2.lastEvent.account).to.equal(addr2.address);
      expect(withdrawal2.lastEvent.amount).to.be.equal(withdrawal2.delta);
      expect(withdrawal2.lastEvent.penalty).to.equal(0);
      expect(withdrawal2.lastEvent.holdBonus
        .add(withdrawal2.lastEvent.commitBonus))
        .to.be.equal(bonus2);
      expect(withdrawal2.lastEvent.timeHeld).to.gt(minCommitPeriod);

      // check can't withdraw any more
      await expect(addr2Caller.withdrawWithPenalty(deployedToken.address))
        .to.revertedWith("nonexistent");
    });

    it("no bonus with penalty", async function () {
      const tx = 1000;
      await addr1TokenCaller.approve(deployed.address, tx);
      await addr1Caller.deposit(
        deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      const dep1 = (await TestUtils.lastDepositEvent(deployed)).tokenId;
      
      // withdraw with penalty
      const withdrawal1 = await TestUtils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () =>  await addr1Caller.withdrawWithPenalty(dep1)
      );
      
      const penalty1 = ethers.BigNumber.from(tx).sub(withdrawal1.delta);
      expect(penalty1).to.gt(0);

      // deposit as 2
      await addr1TokenCaller.transfer(addr2.address, tx);
      await addr2TokenCaller.approve(deployed.address, tx);
      await addr2Caller.deposit(
        deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      const dep2 = (await TestUtils.lastDepositEvent(deployed)).tokenId;
      // check 2 deserves commitBonus (if holds)
      const state2 = await TestUtils.getState(deployed, deployedToken, dep2);
      expect(state2.commitBonus)
        .to.equal(penalty1.div(2));

      // check penalty is not affected by bonus and no bonus is withdrawn by 2
      const withdrawal2 = await TestUtils.callCaptureEventAndBalanceToken(
        addr2.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () =>  await addr2Caller.withdrawWithPenalty(dep2)
      );
      const penalty2 = ethers.BigNumber.from(tx).sub(withdrawal2.delta);
      expect(penalty2).to.be.equal(penalty1);
      
      const state3 = await TestUtils.poolDetails(deployed, deployedToken);
      expect(state3.holdBonusesSum.add(state3.commitBonusesSum))
        .to.be.equal(penalty1.add(penalty2));
    });

    it("bonus divided correctly between two holders", async function () {
      const tx = 1000;
      await addr1TokenCaller.approve(deployed.address, 2 * tx);
      await addr1Caller.deposit(
        deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      const dep0 = (await TestUtils.lastDepositEvent(deployed)).tokenId;
      
      // withdraw with penalty, original bonus sums = 2000
      await addr1Caller.withdrawWithPenalty(dep0);

      await addr1TokenCaller.transfer(addr2.address, 2 * tx);
      await addr2TokenCaller.approve(deployed.address, 2 * tx);
      // deposit again as 1, and deposit as 2, but twice as much      
      await addr1Caller.deposit(
        deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      const dep1 = (await TestUtils.lastDepositEvent(deployed)).tokenId;
      await addr2Caller.deposit(
        deployedToken.address, 2 * tx, minInitialPenaltyPercent, minCommitPeriod); 
      const dep2 = (await TestUtils.lastDepositEvent(deployed)).tokenId;

      // check 2 deserves commit bonus (if holds)
      const state1 = await TestUtils.getState(deployed, deployedToken, dep1);
      const state2 = await TestUtils.getState(deployed, deployedToken, dep2);
      expect(state1.commitBonus).to.gt(0);  // check deserves bonus
      // check commit bonuses are divided correctly
      expect(state2.commitBonus).to.equal(state1.commitBonus.mul(2));  
      // check commit  bonuses sum
      expect(state2.commitBonusesSum).to.be.equal(state1.commitBonus.mul(3));

      // move time
      await TestUtils.evmIncreaseTime(minCommitPeriod);
      const state3 = await TestUtils.getState(deployed, deployedToken, dep2);

      // check actual withdrawal matches bonusOf
      const withdrawal2 = await TestUtils.callCaptureEventAndBalanceToken(
        addr2.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () =>  await addr2Caller.withdrawWithPenalty(dep2)
      );
      // check two gets correct amount of commit bonus
      expect(withdrawal2.lastEvent.commitBonus).to.eq(state2.commitBonus);
      const actualBonus = withdrawal2.delta.sub(tx * 2);
      // actual holdBonus may be slightly different because of time
      expect(actualBonus).to.be
        .closeTo(state3.holdBonus.add(state3.commitBonus), 10);      
    });    

  });

});

