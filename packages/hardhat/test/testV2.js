const { ethers, network, config } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");
const { parseUnits } = require("@ethersproject/units");

const contractName = "HodlPoolV2";
const tokenContractName = "SomeToken";
const feeTokenContractName = "FeeToken";
const wethContractName = "WETH";

use(solidity);

describe(contractName, function () {

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

  describe("deployment", function () {

    describe("successful deployment public params", function () {
      it("minInitialPenaltyPercent value", async function () {
        expect(await deployed.minInitialPenaltyPercent()).to.equal(deployArgs[0]);
      });
      it("minCommitPeriod value", async function () {
        expect(await deployed.minCommitPeriod()).to.equal(deployArgs[1]);
      });
    });

    describe("bad deployment params", function () {
      it("should not deploy minInitialPenaltyPercent > 100", async function () {
        const badArgs = [101, minCommitPeriod, deployedWETH.address];
        expect(contract.deploy(...badArgs)).to.be.revertedWith("100%");
      });
      it("should not deploy minInitialPenaltyPercent == 0", async function () {
        const badArgs = [0, minCommitPeriod, deployedWETH.address];
        expect(contract.deploy(...badArgs)).to.be.revertedWith("no min penalty");
      });
      it("should not deploy minCommitPeriod < 10s", async function () {
        const badArgs = [minInitialPenaltyPercent, 2, deployedWETH.address];
        expect(contract.deploy(...badArgs)).to.be.revertedWith("too short");
      });
      it("should not deploy minCommitPeriod > 365 days", async function () {
        const badArgs = [minInitialPenaltyPercent, 366 * 86400, deployedWETH.address];
        expect(contract.deploy(...badArgs)).to.be.revertedWith("too long");
      });
      it("should not deploy WETH zero address", async function () {
        const badArgs = [...deployArgs, ethers.constants.AddressZero];
        expect(contract.deploy(...badArgs)).to.be.revertedWith("0x0");
      });
    });

    it("deployment can not be payable", async function () {
      expect(contract.deploy(
        ...deployArgs, deployedWETH.address, { value: 1000 })).to.be.reverted;
    });
  });

  describe("unsupported methods", function () {
    it("no receive or fallback", async function () {
      const tx = { to: deployed.address, value: 1000 };
      expect(addr1.sendTransaction(tx)).to.revertedWith("no receive");
    })
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
      const depositTwice = await callCaptureEventAndBalanceToken(
        addr1.address, 
        deployed.filters.Deposited(), 
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
      const state = await getState(deployed, deployedToken, addr1);
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

      const state1 = await getState(deployed, deployedToken, addr1);
      const state2 = await getState(deployed, deployedToken2, addr1);

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
        (await getState(deployed, deployedToken, addr1)).penalty)
        .to.equal(dep * penaltyPercent / 100);

      // back to the future to 50% time
      await evmIncreaseTime(minCommitPeriod / 2)
      expect(
        (await getState(deployed, deployedToken, addr1)).penalty)
        .to.equal(dep * penaltyPercent / (2 * 100));
      
      // back to the future to 100% time
      await evmIncreaseTime(minCommitPeriod / 2)
      expect(
        (await getState(deployed, deployedToken, addr1)).penalty)
        .to.equal(0);
    });

    it("penaltyOf & withdrawWithBonus & timeLeftToHoldOf with time passage", 
      async function () 
    {
      const dep = 1000;
      await addr1TokenCaller.approve(deployed.address, dep);
      await addr1Caller.deposit(
        deployedToken.address, dep, minInitialPenaltyPercent, minCommitPeriod);
      const state0 = await getState(deployed, deployedToken, addr1);
      const depositBalance = state0.balance;

      // should be full penalty
      const state1 = await getState(deployed, deployedToken, addr1);
      expect(state1.penalty).to.equal(depositBalance);
      // should need to wait full commit period
      expect(state1.timeLeftToHold).to.equal(minCommitPeriod);

      // back to the future to 50% time
      await evmIncreaseTime(minCommitPeriod / 2);
      const state2 = await getState(deployed, deployedToken, addr1);
      expect(state2.penalty).to.equal(depositBalance / 2);
      // only half the time left to wait
      expect(state2.timeLeftToHold).to.equal(minCommitPeriod / 2);

      // try to withdraw without penalty and fail
      await expect(addr1Caller.withdrawWithBonus(deployedToken.address))
        .to.revertedWith("penalty");
      
      // back to the future to 100% time
      await evmIncreaseTime(minCommitPeriod / 2);
      const state3 = await getState(deployed, deployedToken, addr1);
      expect(state3.penalty).to.equal(0);
      // no need to wait any longer
      expect(state3.timeLeftToHold).to.equal(0);

      const withdrawal = await callCaptureEventAndBalanceToken(
        addr1.address, 
        deployed.filters.Withdrawed(), 
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
      await evmIncreaseTime((minCommitPeriod / 2) - 1);  // write transaction will add some time

      const withdrawal = await callCaptureEventAndBalanceToken(
        addr1.address, 
        deployed.filters.Withdrawed(), 
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

      const state = await getState(deployed, deployedFeeToken, addr1);

      // check balanceOf()
      expect(state.balance).to.equal(tx * transferRatio);

      // check depositsSum
      expect(state.depositsSum).to.equal(tx * transferRatio);

      // check contract token balance
      expect(await deployedFeeToken.balanceOf(deployed.address))
        .to.equal(tx * transferRatio);

      // move time to be able to withdraw fully
      await evmIncreaseTime(minCommitPeriod);
      
      const withdrawal = await callCaptureEventAndBalanceToken(
        addr1.address, 
        deployed.filters.Withdrawed(), 
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
      await evmIncreaseTime((minCommitPeriod / 2) - 1);
      
      const withdrawal1 = await callCaptureEventAndBalanceToken(
        addr1.address, 
        deployed.filters.Withdrawed(), 
        deployedFeeToken,
        async () => {
          await expect(addr1Caller.withdrawWithPenalty(deployedFeeToken.address))
            .to.emit(deployed, "Withdrawed");
        }
      );

      // should be able to withdraw but expect to pay token fee again
      expect(withdrawal1.lastEvent.amount).to.equal(tx * transferRatio / 2);
      expect(withdrawal1.delta).to.equal(tx * transferRatio * transferRatio / 2);  // due to second transfer

      const state = await getState(deployed, deployedFeeToken, addr1);
      // check bonus pool
      expect(state.holdBonusesSum.add(state.commitBonusesSum))
        .to.equal(tx * transferRatio / 2)

      // deposit again
      await addr1FeeTokenCaller.approve(deployed.address, tx);
      await addr1Caller.deposit(
        deployedFeeToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);

      // move time
      await evmIncreaseTime(minCommitPeriod);

      const withdrawal2 = await callCaptureEventAndBalanceToken(
        addr1.address, 
        deployed.filters.Withdrawed(), 
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
      expect((await getState(deployed, deployedToken, addr1)).holdBonus).to.equal(0);
      expect((await getState(deployed, deployedToken, addr1)).commitBonus).to.equal(0);
      expect((await getState(deployed, deployedToken, addr2)).holdBonus).to.equal(0);
      expect((await getState(deployed, deployedToken, addr2)).commitBonus).to.equal(0);
      // check depositsSum
      expect((await getState(deployed, deployedToken, addr1)).depositsSum).to.equal(tx1 + tx2);

      // withdraw with penalty
      const withdrawal1 = await callCaptureEventAndBalanceToken(
        addr1.address, 
        deployed.filters.Withdrawed(), 
        deployedToken,
        async () =>  await addr1Caller.withdrawWithPenalty(deployedToken.address)
      );
      
      // check penalty was non-0
      const penalty1 = ethers.BigNumber.from(tx1).sub(withdrawal1.delta);
      expect(penalty1).to.gt(0);

      // check bonus of 2 is penalty of 1
      const state2 = await getState(deployed, deployedToken, addr2);
      expect(state2.holdBonus.add(state2.commitBonus))
        .to.equal(penalty1);
      expect(state2.holdBonusesSum.add(state2.commitBonusesSum)).to.equal(penalty1);

      // check 2 can't withdraw with bonus too soon
      await expect(addr2Caller.withdrawWithBonus(deployedToken.address))
        .to.revertedWith("penalty");

      // move time
      await evmIncreaseTime(minCommitPeriod);  

      // withdraw bonus
      const withdrawal2 = await callCaptureEventAndBalanceToken(
        addr2.address, 
        deployed.filters.Withdrawed(), 
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
      const withdrawal1 = await callCaptureEventAndBalanceToken(
        addr1.address, 
        deployed.filters.Withdrawed(), 
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
      const state2 = await getState(deployed, deployedToken, addr2);
      expect(state2.commitBonus)
        .to.equal(penalty1.div(2));

      // check penalty is not affected by bonus and no bonus is withdrawn by 2
      const withdrawal2 = await callCaptureEventAndBalanceToken(
        addr2.address, 
        deployed.filters.Withdrawed(), 
        deployedToken,
        async () =>  await addr2Caller.withdrawWithPenalty(deployedToken.address)
      );
      const penalty2 = ethers.BigNumber.from(tx).sub(withdrawal2.delta);
      expect(penalty2).to.be.equal(penalty1);
      
      const state3 = await getState(deployed, deployedToken, addr2);
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
      const state1 = await getState(deployed, deployedToken, addr1);
      const state2 = await getState(deployed, deployedToken, addr2);
      expect(state1.commitBonus).to.gt(0);  // check deserves bonus
      // check commit bonuses are divided correctly
      expect(state2.commitBonus).to.equal(state1.commitBonus.mul(2));  
      // check commit  bonuses sum
      expect(state2.commitBonusesSum).to.be.equal(state1.commitBonus.mul(3));

      // move time
      await evmIncreaseTime(minCommitPeriod);
      const state3 = await getState(deployed, deployedToken, addr2);

      // check actual withdrawal matches bonusOf
      const withdrawal2 = await callCaptureEventAndBalanceToken(
        addr2.address, 
        deployed.filters.Withdrawed(), 
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
      const depositTwice = await callCaptureEventAndBalanceETH(
        addr1.address, 
        deployed.filters.Deposited(), 
        async () => {
          await expect(addr1Caller.depositETH(
            minInitialPenaltyPercent, minCommitPeriod, tx)).to.emit(deployed, "Deposited");
          await expect(addr1Caller.depositETH(
            minInitialPenaltyPercent, minCommitPeriod, tx)).to.emit(deployed, "Deposited");
        }
      );
      
      const blockTimestamp = (await ethers.provider.getBlock()).timestamp;

      const expectedSum = tx.value * 2;
      const state = await getState(deployed, deployedWETH, addr1);
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
        
      const state0 = await getState(deployed, deployedWETH, addr1);
      const depositBalance = state0.balance;
      // should be full penalty
      expect(state0.penalty).to.equal(depositBalance);
      // should need to wait full commit period
      expect(state0.timeLeftToHold).to.equal(minCommitPeriod);

      // back to the future to 50% time
      await evmIncreaseTime(minCommitPeriod / 2)
      const state1 = await getState(deployed, deployedWETH, addr1);
      expect(state1.penalty).to.equal(depositBalance / 2);
      // only half the time left to wait
      expect(state1.timeLeftToHold).to.equal(minCommitPeriod / 2);

      // try to withdraw without penalty and fail
      await expect(addr1Caller.withdrawWithBonusETH()).to.revertedWith("penalty");
      
      // back to the future to 100% time
      await evmIncreaseTime(minCommitPeriod / 2)
      const state2 = await getState(deployed, deployedWETH, addr1);
      expect(state2.penalty).to.equal(0);
      // no need to wait any longer
      expect(state2.timeLeftToHold).to.equal(0);

      const withdrawal = await callCaptureEventAndBalanceETH(
        addr1.address, 
        deployed.filters.Withdrawed(), 
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
      await evmIncreaseTime((minCommitPeriod / 2) - 1);  // write transaction will add some time

      const withdrawal = await callCaptureEventAndBalanceETH(
        addr1.address, 
        deployed.filters.Withdrawed(), 
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
      const state1 = await getState(deployed, deployedWETH, addr1);
      const state2 = await getState(deployed, deployedWETH, addr2);
      expect(state1.commitBonus).to.equal(0);
      expect(state1.holdBonus).to.equal(0);
      expect(state2.commitBonus).to.equal(0);
      expect(state2.holdBonus).to.equal(0);
      // check depositsSum
      expect(state1.depositsSum).to.equal(tx1.value + tx2.value);

      // withdraw with penalty
      const withdrawal1 = await callCaptureEventAndBalanceETH(
        addr1.address, 
        deployed.filters.Withdrawed(), 
        async () =>  await addr1Caller.withdrawWithPenaltyETH({ gasPrice: 0 })
      );
      
      // check penalty was non-0
      const penalty1 = ethers.BigNumber.from(tx1.value).sub(withdrawal1.delta);
      expect(penalty1).to.gt(0);

      // check bonus of 2 is penalty of 1
      const state3 = await getState(deployed, deployedWETH, addr2);
      expect(state3.holdBonus.add(state3.commitBonus)).to.equal(penalty1);
      expect(state3.holdBonusesSum.add(state3.commitBonusesSum)).to.equal(penalty1);

      // check 2 can't withdraw with bonus too soon
      await expect(addr2Caller.withdrawWithBonusETH()).to.revertedWith("penalty");

      // move time
      await evmIncreaseTime(minCommitPeriod);  

      // withdraw bonus
      const withdrawal2 = await callCaptureEventAndBalanceETH(
        addr2.address, 
        deployed.filters.Withdrawed(), 
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

      const state1 = await getState(deployed, deployedWETH, addr1);
      const state2 = await getState(deployed, deployedWETH, addr2);
      // check 2 deserves bonus (if holds)
      expect(state1.commitBonus).to.gt(0);  // check deserves bonus
      // check bonuses are divided correctly
      expect(state2.commitBonus).to.equal(state1.commitBonus.mul(2));  
      // check bonuses sum
      expect(state2.commitBonusesSum).to.be.equal(state1.commitBonus.mul(3));
      // check half is in hold bonuses
      expect(state2.holdBonusesSum).to.be.equal(state2.commitBonusesSum);

      // move time
      await evmIncreaseTime(minCommitPeriod);

      const state3 = await getState(deployed, deployedWETH, addr2);
      // check actual withdrawal matches bonusOf
      const withdrawal2 = await callCaptureEventAndBalanceETH(
        addr2.address, 
        deployed.filters.Withdrawed(), 
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

  //// test utils

  // all contract views in a single object
  async function getState(contract, tokenContract, signer) {
    const depositDetails = await contract.depositDetails(tokenContract.address, signer.address);
    const poolDetails = await contract.poolDetails(tokenContract.address);
    return {
      // deposit
      balance: depositDetails[0],
      timeLeftToHold: depositDetails[1],
      penalty: depositDetails[2],
      holdBonus: depositDetails[3],
      commitBonus: depositDetails[4],
      holdPoints: depositDetails[5],
      commitPoints: depositDetails[6],
      initialPenaltyPercent: depositDetails[7],
      currentPenaltyPercent: depositDetails[8],
      commitPeriod: depositDetails[9],
      // pool
      depositsSum: poolDetails[0],
      holdBonusesSum: poolDetails[1],
      commitBonusesSum: poolDetails[2],
      totalHoldPoints: poolDetails[3],
      totalCommitPoints: poolDetails[4],
    }
  }

  // advances EVM time into the future
  const evmIncreaseTime = async (seconds) => {
    await network.provider.send("evm_increaseTime", [seconds + 0.5]);
    await network.provider.send("evm_mine");
  }

  // runs transactions and checks token balance difference and last event
  async function callCaptureEventAndBalanceToken(
    address, eventFilter, tokenContract, callsFunc
  ) {      
    const startBalance = await tokenContract.balanceOf(address);
    await callsFunc();  // run the transactions
    const txBlock = await ethers.provider.getBlockNumber();
    const endBalance = await tokenContract.balanceOf(address);
    // event
    const lastEvent = (await deployed.queryFilter(eventFilter, txBlock, txBlock))[0].args;  
    return {
      delta: endBalance.sub(startBalance), 
      lastEvent,
    };
  }

  // runs transactions and checks ETH balance difference and last event
  async function callCaptureEventAndBalanceETH(
    address, eventFilter, callsFunc
  ) {      
    const startBalance = await ethers.provider.getBalance(address);
    await callsFunc();  // run the transactions
    const txBlock = await ethers.provider.getBlockNumber();
    const endBalance = await ethers.provider.getBalance(address);
    // event
    const lastEvent = (await deployed.queryFilter(eventFilter, txBlock, txBlock))[0].args;  
    return {
      delta: endBalance.sub(startBalance), 
      lastEvent,
    };
  }
  
});

