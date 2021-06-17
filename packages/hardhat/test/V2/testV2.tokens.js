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

describe(`${contractName} tokens`, function () {

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

  describe("tokens: single account deposits & withdrawals", function () {
    let addr1Caller;
    let addr1TokenCaller;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
      addr1TokenCaller = deployedToken.connect(addr1);
      addr1FeeTokenCaller = deployedFeeToken.connect(addr1);
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
        .deposit(deployedToken.address, parseUnits("1.001", 18), minInitialPenaltyPercent, minCommitPeriod))
        .to.revertedWith("exceeds balance");
    })

    it("can't deposit without allowance", async function () {
      expect(
        addr1Caller
        .deposit(deployedToken.address, parseUnits("0.001", 18), minInitialPenaltyPercent, minCommitPeriod))
        .to.revertedWith("exceeds allowance");
    })

    it("can't deposit 0", async function () {
      expect(addr1Caller
        .deposit(deployedToken.address, 0, minInitialPenaltyPercent, minCommitPeriod))
        .to.revertedWith("too small");
    })

    it("can't withdrawWithBonus if didn't deposit", async function () {
      expect(addr1Caller.withdrawWithBonus(deployedToken.address))
        .to.revertedWith("no deposit");
    });

    it("can't withdrawWithPenalty if didn't deposit", async function () {
      expect(addr1Caller.withdrawWithPenalty(deployedToken.address))
        .to.revertedWith("no deposit");
    });

    it("can deposit twice", async function () {
      const tx = 1000;
      // approve tokens
      await addr1TokenCaller.approve(deployed.address, tx * 2);

      // make the calls
      const depositTwice = await Utils.callCaptureEventAndBalanceToken(
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

      const expectedSum = tx * 2;
      const state = await Utils.getState(deployed, deployedToken, addr1);
      // check balance
      expect(state.balance).to.equal(expectedSum);
      // check depositsSum
      expect(state.depositsSum).to.equal(expectedSum);
      // check contract token balance
      expect(await deployedToken.balanceOf(deployed.address)).to.equal(expectedSum);
      // check event
      expect(depositTwice.lastEvent.sender).to.equal(addr1.address);
      expect(depositTwice.lastEvent.amount).to.equal(tx);
      expect(depositTwice.lastEvent.time).to.equal(blockTimestamp);
    });

    it("can deposit different tokens", async function () {
      // deploy second token
      tokenContract2 = await ethers.getContractFactory(tokenContractName);
      deployedToken2 = await tokenContract2.deploy(
        "Token2", "TK2", addr1.address, parseUnits("2", 18));
      addr1Token2Caller = deployedToken2.connect(addr1);

      const tx = 1000;
      // approve tokens
      await addr1TokenCaller.approve(deployed.address, tx);
      await addr1Token2Caller.approve(deployed.address, tx);

      // make deposits
      await addr1Caller.deposit(
        deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      await addr1Caller.deposit(
        deployedToken2.address, tx, minInitialPenaltyPercent, minCommitPeriod);

      const state1 = await Utils.getState(deployed, deployedToken, addr1);
      const state2 = await Utils.getState(deployed, deployedToken2, addr1);

      // check balance
      expect(state1.balance).to.equal(tx);
      expect(state2.balance).to.equal(tx);

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

      // should be full penalty
      expect(
        (await Utils.getState(deployed, deployedToken, addr1)).penalty)
        .to.equal(dep * penaltyPercent / 100);

      // back to the future to 50% time
      await Utils.evmIncreaseTime(minCommitPeriod / 2)
      expect(
        (await Utils.getState(deployed, deployedToken, addr1)).penalty)
        .to.equal(dep * penaltyPercent / (2 * 100));
      
      // back to the future to 100% time
      await Utils.evmIncreaseTime(minCommitPeriod / 2)
      expect(
        (await Utils.getState(deployed, deployedToken, addr1)).penalty)
        .to.equal(0);
    });

    it("penaltyOf & withdrawWithBonus & timeLeftToHoldOf with time passage", 
      async function () 
    {
      const dep = 1000;
      await addr1TokenCaller.approve(deployed.address, dep);
      await addr1Caller.deposit(
        deployedToken.address, dep, minInitialPenaltyPercent, minCommitPeriod);
      const state0 = await Utils.getState(deployed, deployedToken, addr1);
      const depositBalance = state0.balance;

      // should be full penalty
      const state1 = await Utils.getState(deployed, deployedToken, addr1);
      expect(state1.penalty).to.equal(depositBalance);
      // should need to wait full commit period
      expect(state1.timeLeftToHold).to.equal(minCommitPeriod);

      // back to the future to 50% time
      await Utils.evmIncreaseTime(minCommitPeriod / 2);
      const state2 = await Utils.getState(deployed, deployedToken, addr1);
      expect(state2.penalty).to.equal(depositBalance / 2);
      // only half the time left to wait
      expect(state2.timeLeftToHold).to.equal(minCommitPeriod / 2);

      // try to withdraw without penalty and fail
      await expect(addr1Caller.withdrawWithBonus(deployedToken.address))
        .to.revertedWith("penalty");
      
      // back to the future to 100% time
      await Utils.evmIncreaseTime(minCommitPeriod / 2);
      const state3 = await Utils.getState(deployed, deployedToken, addr1);
      expect(state3.penalty).to.equal(0);
      // no need to wait any longer
      expect(state3.timeLeftToHold).to.equal(0);

      const withdrawal = await Utils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () => {
          await expect(addr1Caller.withdrawWithBonus(deployedToken.address))
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
      expect(addr1Caller.withdrawWithPenalty(deployedToken.address))
        .to.revertedWith("no deposit");
    });

    it("withdrawWithPenalty before commit period end", async function () {
      const tx = 1000;
      await addr1TokenCaller.approve(deployed.address, tx);
      await addr1Caller.deposit(
        deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);

      // back to the future to 50% time
      await Utils.evmIncreaseTime((minCommitPeriod / 2) - 1);  // write transaction will add some time

      const withdrawal = await Utils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () => {
          await expect(addr1Caller.withdrawWithPenalty(deployedToken.address))
            .to.emit(deployed, "Withdrawed");
        }
      );

      // should be able to withdraw half now
      expect(withdrawal.delta).to.equal(tx / 2);

      // check event
      expect(withdrawal.lastEvent.sender).to.equal(addr1.address);
      expect(withdrawal.lastEvent.amount).to.equal(tx / 2);
      expect(withdrawal.lastEvent.penalty).to.equal(tx / 2);
      expect(withdrawal.lastEvent.holdBonus).to.equal(0);
      expect(withdrawal.lastEvent.commitBonus).to.equal(0);
      expect(withdrawal.lastEvent.timeHeld).to.equal(minCommitPeriod / 2);

      // check can't withdraw any more
      expect(addr1Caller.withdrawWithPenalty(deployedToken.address))
        .to.revertedWith("no deposit");
    });

    it("withdraw and balances with fee-on-transfer token", async function () {
      const tx = 1000;
      const transferRatio = (100 - tokenFeePercent) / 100;
      // approve tokens
      await addr1FeeTokenCaller.approve(deployed.address, tx);

      // make deposits
      await addr1Caller.deposit(
        deployedFeeToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);

      const state = await Utils.getState(deployed, deployedFeeToken, addr1);

      // check balanceOf()
      expect(state.balance).to.equal(tx * transferRatio);

      // check depositsSum
      expect(state.depositsSum).to.equal(tx * transferRatio);

      // check contract token balance
      expect(await deployedFeeToken.balanceOf(deployed.address))
        .to.equal(tx * transferRatio);

      // move time to be able to withdraw fully
      await Utils.evmIncreaseTime(minCommitPeriod);
      
      const withdrawal = await Utils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()),
        deployedFeeToken,
        async () => {
          await expect(addr1Caller.withdrawWithBonus(deployedFeeToken.address))
            .to.emit(deployed, "Withdrawed");
        }
      );

      // should be able to withdraw but expect to pay token fee again
      expect(withdrawal.lastEvent.amount).to.equal(tx * transferRatio);
      expect(withdrawal.delta).to.equal(tx * transferRatio * transferRatio);  // due to second transfer
    })

    it("withdraw penalty and bonus with fee-on-transfer token", async function () {
      const tx = 1000;
      const transferRatio = (100 - tokenFeePercent) / 100;
      // approve and deposit
      await addr1FeeTokenCaller.approve(deployed.address, tx);
      await addr1Caller.deposit(
        deployedFeeToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);

      // move time
      await Utils.evmIncreaseTime((minCommitPeriod / 2) - 1);
      
      const withdrawal1 = await Utils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedFeeToken,
        async () => {
          await expect(addr1Caller.withdrawWithPenalty(deployedFeeToken.address))
            .to.emit(deployed, "Withdrawed");
        }
      );

      // should be able to withdraw but expect to pay token fee again
      expect(withdrawal1.lastEvent.amount).to.equal(tx * transferRatio / 2);
      expect(withdrawal1.delta).to.equal(tx * transferRatio * transferRatio / 2);  // due to second transfer

      const state = await Utils.getState(deployed, deployedFeeToken, addr1);
      // check bonus pool
      expect(state.holdBonusesSum.add(state.commitBonusesSum))
        .to.equal(tx * transferRatio / 2)

      // deposit again
      await addr1FeeTokenCaller.approve(deployed.address, tx);
      await addr1Caller.deposit(
        deployedFeeToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);

      // move time
      await Utils.evmIncreaseTime(minCommitPeriod);

      const withdrawal2 = await Utils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedFeeToken,
        async () => {
          await expect(addr1Caller.withdrawWithBonus(deployedFeeToken.address))
            .to.emit(deployed, "Withdrawed");
        }
      );

      // should be able to withdraw but expect to pay token fee again
      expect(withdrawal2.lastEvent.amount).to.equal(
        (tx * transferRatio / 2) + (tx * transferRatio));  // bonus + deposit
      expect(withdrawal2.delta).to.equal(
        ((tx * transferRatio / 2) + (tx * transferRatio)) * transferRatio);  // due to second transfer
    })

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
      await addr2TokenCaller.approve(deployed.address, tx2);
      await addr2Caller.deposit(
        deployedToken.address, tx2, minInitialPenaltyPercent, minCommitPeriod);

      // no bunus initially
      expect((await Utils.getState(deployed, deployedToken, addr1)).holdBonus).to.equal(0);
      expect((await Utils.getState(deployed, deployedToken, addr1)).commitBonus).to.equal(0);
      expect((await Utils.getState(deployed, deployedToken, addr2)).holdBonus).to.equal(0);
      expect((await Utils.getState(deployed, deployedToken, addr2)).commitBonus).to.equal(0);
      // check depositsSum
      expect((await Utils.getState(deployed, deployedToken, addr1)).depositsSum).to.equal(tx1 + tx2);

      // withdraw with penalty
      const withdrawal1 = await Utils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () =>  await addr1Caller.withdrawWithPenalty(deployedToken.address)
      );
      
      // check penalty was non-0
      const penalty1 = ethers.BigNumber.from(tx1).sub(withdrawal1.delta);
      expect(penalty1).to.gt(0);

      // check bonus of 2 is penalty of 1
      const state2 = await Utils.getState(deployed, deployedToken, addr2);
      expect(state2.holdBonus.add(state2.commitBonus))
        .to.equal(penalty1);
      expect(state2.holdBonusesSum.add(state2.commitBonusesSum)).to.equal(penalty1);

      // check 2 can't withdraw with bonus too soon
      await expect(addr2Caller.withdrawWithBonus(deployedToken.address))
        .to.revertedWith("penalty");

      // move time
      await Utils.evmIncreaseTime(minCommitPeriod);  

      // withdraw bonus
      const withdrawal2 = await Utils.callCaptureEventAndBalanceToken(
        addr2.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () =>  await addr2Caller.withdrawWithBonus(deployedToken.address)
      );

      const bonus2 = ethers.BigNumber.from(withdrawal2.delta).sub(tx2);
      // check withdrawal of correct bonus amount
      expect(bonus2).to.equal(penalty1);

      // check event
      expect(withdrawal2.lastEvent.sender).to.equal(addr2.address);
      expect(withdrawal2.lastEvent.amount).to.be.equal(withdrawal2.delta);
      expect(withdrawal2.lastEvent.penalty).to.equal(0);
      expect(withdrawal2.lastEvent.holdBonus
        .add(withdrawal2.lastEvent.commitBonus))
        .to.be.equal(bonus2);
      expect(withdrawal2.lastEvent.timeHeld).to.gt(minCommitPeriod);

      // check can't withdraw any more
      await expect(addr2Caller.withdrawWithPenalty(deployedToken.address))
        .to.revertedWith("no deposit");
    });

    it("no bonus with penalty", async function () {
      const tx = 1000;
      await addr1TokenCaller.approve(deployed.address, tx);
      await addr1Caller.deposit(
        deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      
      // withdraw with penalty
      const withdrawal1 = await Utils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () =>  await addr1Caller.withdrawWithPenalty(deployedToken.address)
      );
      
      const penalty1 = ethers.BigNumber.from(tx).sub(withdrawal1.delta);
      expect(penalty1).to.gt(0);

      // deposit as 2
      await addr1TokenCaller.transfer(addr2.address, tx);
      await addr2TokenCaller.approve(deployed.address, tx);
      await addr2Caller.deposit(
        deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      // check 2 deserves commitBonus (if holds)
      const state2 = await Utils.getState(deployed, deployedToken, addr2);
      expect(state2.commitBonus)
        .to.equal(penalty1.div(2));

      // check penalty is not affected by bonus and no bonus is withdrawn by 2
      const withdrawal2 = await Utils.callCaptureEventAndBalanceToken(
        addr2.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () =>  await addr2Caller.withdrawWithPenalty(deployedToken.address)
      );
      const penalty2 = ethers.BigNumber.from(tx).sub(withdrawal2.delta);
      expect(penalty2).to.be.equal(penalty1);
      
      const state3 = await Utils.getState(deployed, deployedToken, addr2);
      expect(state3.holdBonusesSum.add(state3.commitBonusesSum))
        .to.be.equal(penalty1.add(penalty2));
    });

    it("bonus divided correctly between two holders", async function () {
      const tx = 1000;
      await addr1TokenCaller.approve(deployed.address, 2 * tx);
      await addr1Caller.deposit(
        deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      
      // withdraw with penalty, original bonus sums = 2000
      await addr1Caller.withdrawWithPenalty(deployedToken.address);

      await addr1TokenCaller.transfer(addr2.address, 2 * tx);
      await addr2TokenCaller.approve(deployed.address, 2 * tx);
      // deposit again as 1, and deposit as 2, but twice as much      
      await addr1Caller.deposit(
        deployedToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      await addr2Caller.deposit(
        deployedToken.address, 2 * tx, minInitialPenaltyPercent, minCommitPeriod); 

      // check 2 deserves commit bonus (if holds)
      const state1 = await Utils.getState(deployed, deployedToken, addr1);
      const state2 = await Utils.getState(deployed, deployedToken, addr2);
      expect(state1.commitBonus).to.gt(0);  // check deserves bonus
      // check commit bonuses are divided correctly
      expect(state2.commitBonus).to.equal(state1.commitBonus.mul(2));  
      // check commit  bonuses sum
      expect(state2.commitBonusesSum).to.be.equal(state1.commitBonus.mul(3));

      // move time
      await Utils.evmIncreaseTime(minCommitPeriod);
      const state3 = await Utils.getState(deployed, deployedToken, addr2);

      // check actual withdrawal matches bonusOf
      const withdrawal2 = await Utils.callCaptureEventAndBalanceToken(
        addr2.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedToken,
        async () =>  await addr2Caller.withdrawWithPenalty(deployedToken.address)
      );
      // check two gets correct amount of commit bonus
      expect(withdrawal2.lastEvent.commitBonus).to.eq(state2.commitBonus);
      const actualBonus = withdrawal2.delta.sub(tx * 2);
      // actual holdBonus may be slightly different because of time
      expect(actualBonus.toNumber()).to.be
        .closeTo(state3.holdBonus.add(state3.commitBonus).toNumber(), 10);      
    });    

  });

});

