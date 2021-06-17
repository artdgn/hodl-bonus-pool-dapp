const { ethers, network, config } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");
const { parseUnits } = require("@ethersproject/units");

const { TestUtils: Utils } = require("./utils.js")

const contractName = "HodlPoolV2";
const wethContractName = "WETH";

use(solidity);

describe(`${contractName} ETH`, function () {

  this.retries(3);  // some time dependant tests are flaky
  this.timeout(4000);  // some tests are slow in isolation (several interactions)
  
  let contract;
  let WETHContract;
  let deployed;
  let deployedWETH;
  let owner;
  let addr1;
  let addr2;
  let addrs;

  const minInitialPenaltyPercent = 100;
  const minCommitPeriod = 10;
  const deployArgs = [minInitialPenaltyPercent, minCommitPeriod];

  beforeEach(async () => {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    
    // deploy WETH
    WETHContract = await ethers.getContractFactory(wethContractName);
    deployedWETH = await WETHContract.deploy();
    
    // deploy contract
    contract = await ethers.getContractFactory(contractName);
    deployed = await contract.deploy(...deployArgs, deployedWETH.address);
  });

  describe("ETH: single account deposits & withdrawals", function () {
    let addr1Caller;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
    });

    it("can't deposit 0", async function () {
      expect(addr1Caller
        .depositETH(minInitialPenaltyPercent, minCommitPeriod)).to.revertedWith("too small");
    })

    it("can't withdrawWithBonusETH if didn't deposit", async function () {
      expect(addr1Caller.withdrawWithBonusETH()).to.revertedWith("no deposit");
    });

    it("can't withdrawWithPenaltyETH if didn't deposit", async function () {
      expect(addr1Caller.withdrawWithPenaltyETH()).to.revertedWith("no deposit");
    });

    it("can deposit twice", async function () {
      const tx = { value: 1000 };

      // make the calls
      const depositTwice = await Utils.callCaptureEventAndBalanceETH(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Deposited()), 
        async () => {
          await expect(addr1Caller.depositETH(
            minInitialPenaltyPercent, minCommitPeriod, tx)).to.emit(deployed, "Deposited");
          await expect(addr1Caller.depositETH(
            minInitialPenaltyPercent, minCommitPeriod, tx)).to.emit(deployed, "Deposited");
        }
      );
      
      const blockTimestamp = (await ethers.provider.getBlock()).timestamp;

      const expectedSum = tx.value * 2;
      const state = await Utils.getState(deployed, deployedWETH, addr1);
      // check balanceOf()
      expect(state.balance).to.equal(expectedSum);
      // check depositsSum      
      expect(state.depositsSum).to.equal(expectedSum);
      // check event
      expect(depositTwice.lastEvent.sender).to.equal(addr1.address);
      expect(depositTwice.lastEvent.amount).to.equal(tx.value);
      expect(depositTwice.lastEvent.time).to.equal(blockTimestamp);
    });

    it("penaltyOf & withdrawWithBonusETH & timeLeftToHoldOf with time passage", async function () {
      await addr1Caller.depositETH(
        minInitialPenaltyPercent, minCommitPeriod, { value: 1000 });
        
      const state0 = await Utils.getState(deployed, deployedWETH, addr1);
      const depositBalance = state0.balance;
      // should be full penalty
      expect(state0.penalty).to.equal(depositBalance);
      // should need to wait full commit period
      expect(state0.timeLeftToHold).to.equal(minCommitPeriod);

      // back to the future to 50% time
      await Utils.evmIncreaseTime(minCommitPeriod / 2)
      const state1 = await Utils.getState(deployed, deployedWETH, addr1);
      expect(state1.penalty).to.equal(depositBalance / 2);
      // only half the time left to wait
      expect(state1.timeLeftToHold).to.equal(minCommitPeriod / 2);

      // try to withdraw without penalty and fail
      await expect(addr1Caller.withdrawWithBonusETH()).to.revertedWith("penalty");
      
      // back to the future to 100% time
      await Utils.evmIncreaseTime(minCommitPeriod / 2)
      const state2 = await Utils.getState(deployed, deployedWETH, addr1);
      expect(state2.penalty).to.equal(0);
      // no need to wait any longer
      expect(state2.timeLeftToHold).to.equal(0);

      const withdrawal = await Utils.callCaptureEventAndBalanceETH(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        async () => {
          await expect(addr1Caller.withdrawWithBonusETH({ gasPrice: 0 }))
            .to.emit(deployed, "Withdrawed");
        }
      );

      // should be able to withdraw without penalty now
      expect(withdrawal.delta).to.equal(depositBalance);

      expect(withdrawal.lastEvent.sender).to.equal(addr1.address);
      expect(withdrawal.lastEvent.amount).to.equal(depositBalance);
      expect(withdrawal.lastEvent.penalty).to.equal(0);
      expect(withdrawal.lastEvent.holdBonus).to.equal(0);
      expect(withdrawal.lastEvent.commitBonus).to.equal(0);
      expect(withdrawal.lastEvent.timeHeld).to.gt(minCommitPeriod);

      // check can't withdraw any more
      expect(addr1Caller.withdrawWithPenaltyETH()).to.revertedWith("no deposit");
    });

    it("withdrawWithPenalty before commit period end", async function () {
      const tx = { value: 1000 };
      await addr1Caller.depositETH(minInitialPenaltyPercent, minCommitPeriod, tx);

      // back to the future to 50% time
      await Utils.evmIncreaseTime((minCommitPeriod / 2) - 1);  // write transaction will add some time

      const withdrawal = await Utils.callCaptureEventAndBalanceETH(
        addr1.address,
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        async () => {
          await expect(addr1Caller.withdrawWithPenaltyETH({ gasPrice: 0 }))
            .to.emit(deployed, "Withdrawed");
        }
      );

      // should be able to withdraw half now
      expect(withdrawal.delta).to.equal(tx.value / 2);

      // check event
      expect(withdrawal.lastEvent.sender).to.equal(addr1.address);
      expect(withdrawal.lastEvent.amount).to.equal(tx.value / 2);
      expect(withdrawal.lastEvent.penalty).to.equal(tx.value / 2);
      expect(withdrawal.lastEvent.holdBonus).to.equal(0);
      expect(withdrawal.lastEvent.commitBonus).to.equal(0);
      expect(withdrawal.lastEvent.timeHeld).to.equal(minCommitPeriod / 2);

      // check can't withdraw any more
      expect(addr1Caller.withdrawWithPenaltyETH()).to.revertedWith("no deposit");
    });

  });

  describe("ETH: two accounts bonus behavior", function () {
    let addr1Caller;
    let addr2Caller;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
      addr2Caller = deployed.connect(addr2);
    });

    it("1 penalty 1 bonus", async function () {
      const tx1 = { value: 1000 };
      const tx2 = { value: 2000 };
      await addr1Caller.depositETH(minInitialPenaltyPercent, minCommitPeriod, tx1);
      await addr2Caller.depositETH(minInitialPenaltyPercent, minCommitPeriod, tx2);

      // no bunus initially
      const state1 = await Utils.getState(deployed, deployedWETH, addr1);
      const state2 = await Utils.getState(deployed, deployedWETH, addr2);
      expect(state1.commitBonus).to.equal(0);
      expect(state1.holdBonus).to.equal(0);
      expect(state2.commitBonus).to.equal(0);
      expect(state2.holdBonus).to.equal(0);
      // check depositsSum
      expect(state1.depositsSum).to.equal(tx1.value + tx2.value);

      // withdraw with penalty
      const withdrawal1 = await Utils.callCaptureEventAndBalanceETH(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        async () =>  await addr1Caller.withdrawWithPenaltyETH({ gasPrice: 0 })
      );
      
      // check penalty was non-0
      const penalty1 = ethers.BigNumber.from(tx1.value).sub(withdrawal1.delta);
      expect(penalty1).to.gt(0);

      // check bonus of 2 is penalty of 1
      const state3 = await Utils.getState(deployed, deployedWETH, addr2);
      expect(state3.holdBonus.add(state3.commitBonus)).to.equal(penalty1);
      expect(state3.holdBonusesSum.add(state3.commitBonusesSum)).to.equal(penalty1);

      // check 2 can't withdraw with bonus too soon
      await expect(addr2Caller.withdrawWithBonusETH()).to.revertedWith("penalty");

      // move time
      await Utils.evmIncreaseTime(minCommitPeriod);  

      // withdraw bonus
      const withdrawal2 = await Utils.callCaptureEventAndBalanceETH(
        addr2.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        async () =>  await addr2Caller.withdrawWithBonusETH({ gasPrice: 0 })
      );

      const bonus2 = ethers.BigNumber.from(withdrawal2.delta).sub(tx2.value);
      // check withdrawal of correct bonus amount
      expect(bonus2).to.equal(penalty1);

      // check event
      expect(withdrawal2.lastEvent.sender).to.equal(addr2.address);
      expect(withdrawal2.lastEvent.amount).to.be.equal(withdrawal2.delta);
      expect(withdrawal2.lastEvent.penalty).to.equal(0);
      expect(withdrawal2.lastEvent.holdBonus.add(withdrawal2.lastEvent.commitBonus))
        .to.equal(bonus2);
      expect(withdrawal2.lastEvent.timeHeld).to.gt(minCommitPeriod);

      // check can't withdraw any more
      await expect(addr2Caller.withdrawWithPenaltyETH()).to.revertedWith("no deposit");
    });

    it("bonus divided correctly between two holders", async function () {
      const tx = { value: 1000 };
      await addr1Caller.depositETH(minInitialPenaltyPercent, minCommitPeriod, tx);
      
      // withdraw with penalty
      await addr1Caller.withdrawWithPenaltyETH();

      // deposit again as 1, and deposit as 2, but twice as much
      await addr1Caller.depositETH(minInitialPenaltyPercent, minCommitPeriod, tx);
      await addr2Caller.depositETH(
        minInitialPenaltyPercent, minCommitPeriod, {value: tx.value * 2}); 

      const state1 = await Utils.getState(deployed, deployedWETH, addr1);
      const state2 = await Utils.getState(deployed, deployedWETH, addr2);
      // check 2 deserves bonus (if holds)
      expect(state1.commitBonus).to.gt(0);  // check deserves bonus
      // check bonuses are divided correctly
      expect(state2.commitBonus).to.equal(state1.commitBonus.mul(2));  
      // check bonuses sum
      expect(state2.commitBonusesSum).to.be.equal(state1.commitBonus.mul(3));
      // check half is in hold bonuses
      expect(state2.holdBonusesSum).to.be.equal(state2.commitBonusesSum);

      // move time
      await Utils.evmIncreaseTime(minCommitPeriod);

      const state3 = await Utils.getState(deployed, deployedWETH, addr2);
      // check actual withdrawal matches bonusOf
      const withdrawal2 = await Utils.callCaptureEventAndBalanceETH(
        addr2.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        async () =>  await addr2Caller.withdrawWithPenaltyETH({ gasPrice: 0 })
      ); 

      // check two gets correct amount of commit bonus
      expect(withdrawal2.lastEvent.commitBonus).to.eq(state2.commitBonus);
      const actualBonus = withdrawal2.delta.sub(tx.value * 2);
      // actual holdBonus may be slightly different because of time
      expect(actualBonus.toNumber()).to.be
        .closeTo(state3.holdBonus.add(state2.commitBonus).toNumber(), 10);    
    });    

  });

});

