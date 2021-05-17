const { ethers, network, config } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");
const { parseUnits } = require("@ethersproject/units");

const contractName = "HodlPoolERC20V0";
const tokenContractName = "SomeToken";

use(solidity);

describe(contractName, function () {

  this.retries(3);  // some time dependant tests are flaky
  
  let contract;
  let tokenContract;
  let deployed;
  let deployedToken;
  let owner;
  let addr1;
  let addr2;
  let addrs;

  const initialPenaltyPercent = 100;
  const commitPeriod = 10;
  const deployArgs = [initialPenaltyPercent, commitPeriod];

  beforeEach(async () => {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    
    // deploy token
    tokenContract = await ethers.getContractFactory(tokenContractName);
    deployedToken = await tokenContract.deploy(
      "Token1", "TK1", addr1.address, parseUnits("1", 18));

    // deploy contract
    contract = await ethers.getContractFactory(contractName);
    deployed = await contract.deploy(...deployArgs, deployedToken.address);
  });

  describe("deployment", function () {

    describe("successful deployment public params", function () {
      it("initialPenaltyPercent value", async function () {
        expect(await deployed.initialPenaltyPercent()).to.equal(deployArgs[0]);
      });
      it("commitPeriod value", async function () {
        expect(await deployed.commitPeriod()).to.equal(deployArgs[1]);
      });
    });

    describe("bad deployment params", function () {
      it("should not deploy initialPenaltyPercent > 100", async function () {
        const badArgs = [101, commitPeriod, ethers.constants.AddressZero];
        expect(contract.deploy(...badArgs)).to.be.revertedWith("100%");
      });
      it("should not deploy initialPenaltyPercent == 0", async function () {
        const badArgs = [0, commitPeriod, ethers.constants.AddressZero];
        expect(contract.deploy(...badArgs)).to.be.revertedWith("no penalty");
      });
      it("should not deploy commitPeriod < 10s", async function () {
        const badArgs = [initialPenaltyPercent, 2, ethers.constants.AddressZero];
        expect(contract.deploy(...badArgs)).to.be.revertedWith("too short");
      });
      it("should not deploy commitPeriod > 365 days", async function () {
        const badArgs = [initialPenaltyPercent, 366 * 86400, ethers.constants.AddressZero];
        expect(contract.deploy(...badArgs)).to.be.revertedWith("too long");
      });
    });

    it("deployment can not be payable", async function () {
      expect(contract.deploy(
        ...deployArgs, ethers.constants.AddressZero, { value: 1000 }))
        .to.be.revertedWith("non-payable");
    });
  });

  describe("unsupported methods", function () {
    it("no receive or fallback", async function () {
      const tx = { to: deployed.address, value: 1000 };
      expect(addr1.sendTransaction(tx)).to.revertedWith("no receive");
    })
  });

  describe("single account deposits & withdrawals", function () {
    let addr1Caller;
    let addr1TokenCaller;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
      addr1TokenCaller = deployedToken.connect(addr1);
    });

    it("can't deposit more than token balance", async function () {
      expect(addr1Caller.deposit(parseUnits("1.001", 18))).to.revertedWith("exceeds balance");
    })

    it("can't deposit without allowance", async function () {
      expect(addr1Caller.deposit(parseUnits("0.001", 18))).to.revertedWith("exceeds allowance");
    })

    it("can't deposit 0", async function () {
      expect(addr1Caller.deposit(0)).to.revertedWith("too small");
    })

    it("can't withdrawWithBonus if didn't deposit", async function () {
      expect(addr1Caller.withdrawWithBonus()).to.revertedWith("no deposit");
    });

    it("can't withdrawWithPenalty if didn't deposit", async function () {
      expect(addr1Caller.withdrawWithPenalty()).to.revertedWith("no deposit");
    });

    it("can deposit twice", async function () {
      const tx = 1000;
      // approve tokens
      await addr1TokenCaller.approve(deployed.address, tx * 2);

      // make the calls
      const depositTwice = await callCaptureMetadata(
        addr1.address, 
        deployed.filters.Deposited(), 
        deployedToken,
        async () => {
          await expect(addr1Caller.deposit(tx)).to.emit(deployed, "Deposited");
          await expect(addr1Caller.deposit(tx)).to.emit(deployed, "Deposited");
        }
      );
      
      const blockTimestamp = (await ethers.provider.getBlock()).timestamp;

      const expectedSum = tx * 2;
      // check balanceOf()
      expect(await deployed.balanceOf(addr1.address)).to.equal(expectedSum);
      // check depositsSum
      expect(await deployed.depositsSum()).to.equal(expectedSum);
      // check contract token balance
      expect(await deployedToken.balanceOf(deployed.address)).to.equal(expectedSum);
      // check event
      expect(depositTwice.lastEvent.sender).to.equal(addr1.address);
      expect(depositTwice.lastEvent.amount).to.equal(tx);
      expect(depositTwice.lastEvent.time).to.equal(blockTimestamp);
    });

    it("smaller initial penalty accounting", async function () {
      const penaltyPercent = 10
      deployed = await contract.deploy(penaltyPercent, commitPeriod, deployedToken.address);
      addr1Caller = deployed.connect(addr1);
      const dep = 1000;
      await addr1TokenCaller.approve(deployed.address, dep);
      await addr1Caller.deposit(dep);

      // should be full penalty
      expect(await deployed.penaltyOf(addr1.address))
        .to.equal(dep * penaltyPercent / 100);

      // back to the future to 50% time
      await evmIncreaseTime(commitPeriod / 2)
      expect(await deployed.penaltyOf(addr1.address))
        .to.equal(dep * penaltyPercent / (2 * 100));
      
      // back to the future to 100% time
      await evmIncreaseTime(commitPeriod / 2)
      expect(await deployed.penaltyOf(addr1.address)).to.equal(0);
    });

    it("penaltyOf & withdrawWithBonus & timeLeftToHoldOf with time passage", async function () {
      const dep = 1000;
      await addr1TokenCaller.approve(deployed.address, dep);
      await addr1Caller.deposit(dep);
      const depositBalance = await addr1Caller.balanceOf(addr1.address);

      // should be full penalty
      expect(await deployed.penaltyOf(addr1.address)).to.equal(depositBalance);
      // should need to wait full commit period
      expect(await deployed.timeLeftToHoldOf(addr1.address)).to.equal(commitPeriod);

      // back to the future to 50% time
      await evmIncreaseTime(commitPeriod / 2)
      let penalty = await deployed.penaltyOf(addr1.address);
      expect(penalty).to.equal(depositBalance / 2);
      // only half the time left to wait
      expect(await deployed.timeLeftToHoldOf(addr1.address)).to.equal(commitPeriod / 2);

      // try to withdraw without penalty and fail
      await expect(addr1Caller.withdrawWithBonus()).to.revertedWith("penalty");
      
      // back to the future to 100% time
      await evmIncreaseTime(commitPeriod / 2)
      penalty = await deployed.penaltyOf(addr1.address);
      expect(penalty).to.equal(0);
      // no need to wait any longer
      expect(await deployed.timeLeftToHoldOf(addr1.address)).to.equal(0);

      const withdrawal = await callCaptureMetadata(
        addr1.address, 
        deployed.filters.Withdrawed(), 
        deployedToken,
        async () => {
          await expect(addr1Caller.withdrawWithBonus())
            .to.emit(deployed, "Withdrawed");
        }
      );

      // should be able to withdraw without penalty now
      expect(withdrawal.delta).to.equal(depositBalance);

      expect(withdrawal.lastEvent.sender).to.equal(addr1.address);
      expect(withdrawal.lastEvent.amount).to.equal(depositBalance);
      expect(withdrawal.lastEvent.penalty).to.equal(0);
      expect(withdrawal.lastEvent.bonus).to.equal(0);
      expect(withdrawal.lastEvent.timeHeld).to.gt(commitPeriod);

      // check can't withdraw any more
      expect(addr1Caller.withdrawWithPenalty()).to.revertedWith("no deposit");
    });

    it("withdrawWithPenalty before commit period end", async function () {
      const tx = 1000;
      await addr1TokenCaller.approve(deployed.address, tx);
      await addr1Caller.deposit(tx);

      // back to the future to 50% time
      await evmIncreaseTime((commitPeriod / 2) - 1);  // write transaction will add some time

      const withdrawal = await callCaptureMetadata(
        addr1.address, 
        deployed.filters.Withdrawed(), 
        deployedToken,
        async () => {
          await expect(addr1Caller.withdrawWithPenalty())
            .to.emit(deployed, "Withdrawed");
        }
      );

      // should be able to withdraw half now
      expect(withdrawal.delta).to.equal(tx / 2);

      // check event
      expect(withdrawal.lastEvent.sender).to.equal(addr1.address);
      expect(withdrawal.lastEvent.amount).to.equal(tx / 2);
      expect(withdrawal.lastEvent.penalty).to.equal(tx / 2);
      expect(withdrawal.lastEvent.bonus).to.equal(0);
      expect(withdrawal.lastEvent.timeHeld).to.equal(commitPeriod / 2);

      // check can't withdraw any more
      expect(addr1Caller.withdrawWithPenalty()).to.revertedWith("no deposit");
    });

  });

  describe("two accounts bonus behavior", function () {
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
      await addr1Caller.deposit(tx1);
      await addr2TokenCaller.approve(deployed.address, tx2);
      await addr2Caller.deposit(tx2);

      // no bunus initially
      expect(await deployed.bonusOf(addr1.address)).to.equal(0);
      expect(await deployed.bonusOf(addr2.address)).to.equal(0);
      // check depositsSum
      expect(await deployed.depositsSum()).to.equal(tx1 + tx2);

      // withdraw with penalty
      const withdrawal1 = await callCaptureMetadata(
        addr1.address, 
        deployed.filters.Withdrawed(), 
        deployedToken,
        async () =>  await addr1Caller.withdrawWithPenalty()
      );
      
      // check penalty was non-0
      const penalty1 = ethers.BigNumber.from(tx1).sub(withdrawal1.delta);
      expect(penalty1).to.gt(0);

      // check bonus of 2 is penalty of 1
      expect(await deployed.bonusOf(addr2.address)).to.equal(penalty1);
      expect(await deployed.bonusesPool()).to.equal(penalty1);

      // check 2 can't withdraw with bonus too soon
      await expect(addr2Caller.withdrawWithBonus()).to.revertedWith("penalty");

      // move time
      await evmIncreaseTime(commitPeriod);  

      // withdraw bonus
      const withdrawal2 = await callCaptureMetadata(
        addr2.address, 
        deployed.filters.Withdrawed(), 
        deployedToken,
        async () =>  await addr2Caller.withdrawWithBonus()
      );

      const bonus2 = ethers.BigNumber.from(withdrawal2.delta).sub(tx2);
      // check withdrawal of correct bonus amount
      expect(bonus2).to.equal(penalty1);

      // check event
      expect(withdrawal2.lastEvent.sender).to.equal(addr2.address);
      expect(withdrawal2.lastEvent.amount).to.be.equal(withdrawal2.delta);
      expect(withdrawal2.lastEvent.penalty).to.equal(0);
      expect(withdrawal2.lastEvent.bonus).to.be.equal(bonus2);
      expect(withdrawal2.lastEvent.timeHeld).to.gt(commitPeriod);

      // check can't withdraw any more
      await expect(addr2Caller.withdrawWithPenalty()).to.revertedWith("no deposit");
    });

    it("no bonus with penalty", async function () {
      const tx = 1000;
      await addr1TokenCaller.approve(deployed.address, tx);
      await addr1Caller.deposit(tx);
      
      // withdraw with penalty
      const withdrawal1 = await callCaptureMetadata(
        addr1.address, 
        deployed.filters.Withdrawed(), 
        deployedToken,
        async () =>  await addr1Caller.withdrawWithPenalty()
      );
      
      const penalty1 = ethers.BigNumber.from(tx).sub(withdrawal1.delta);
      expect(penalty1).to.gt(0);

      // deposit as 2
      await addr1TokenCaller.transfer(addr2.address, tx);
      await addr2TokenCaller.approve(deployed.address, tx);
      await addr2Caller.deposit(tx);
      // check 2 deserves bonus (if holds)
      expect(await deployed.bonusOf(addr2.address)).to.equal(penalty1);

      // check penalty is not affected by bonus and no bonus is withdrawn by 2
      const withdrawal2 = await callCaptureMetadata(
        addr2.address, 
        deployed.filters.Withdrawed(), 
        deployedToken,
        async () =>  await addr2Caller.withdrawWithPenalty()
      );
      const penalty2 = ethers.BigNumber.from(tx).sub(withdrawal2.delta);
      expect(penalty2).to.be.equal(penalty1);
      expect(await deployed.bonusesPool()).to.be.equal(penalty1.add(penalty2));
    });

    it("bonus divided correctly between two holders", async function () {
      const tx = 1000;
      await addr1TokenCaller.approve(deployed.address, 2 * tx);
      await addr1Caller.deposit(tx);
      
      // withdraw with penalty
      await addr1Caller.withdrawWithPenalty();

      // deposit again as 1, and deposit as 2, but twice as much
      await addr1Caller.deposit(tx);
      await addr1TokenCaller.transfer(addr2.address, 2 * tx);
      await addr2TokenCaller.approve(deployed.address, 2 * tx);
      await addr2Caller.deposit(2 * tx); 

      // check 2 deserves bonus (if holds)
      const bonus1 = await deployed.bonusOf(addr1.address);
      expect(bonus1).to.gt(0);  // check deserves bonus
      // check bonuses are divided correctly
      expect(await deployed.bonusOf(addr2.address)).to.equal(bonus1.mul(2));  
      // check bonuses sum
      expect(await deployed.bonusesPool()).to.be.equal(bonus1.mul(3));

      // move time
      await evmIncreaseTime(commitPeriod);

      // check actual withdrawal matches bonusOf
      const withdrawal2 = await callCaptureMetadata(
        addr2.address, 
        deployed.filters.Withdrawed(), 
        deployedToken,
        async () =>  await addr2Caller.withdrawWithPenalty()
      );
      expect(withdrawal2.delta.sub(bonus1.mul(2))).to.be.equal(tx * 2);      
    });    

  });

  //// test utils

  // advances EVM time into the future
  const evmIncreaseTime = async (seconds) => {
    await network.provider.send("evm_increaseTime", [seconds + 0.5]);
    await network.provider.send("evm_mine");
  }

  // runs transactions and checks balance difference and last event
  const callCaptureMetadata = async (address, eventFilter, tokenContract, callsFunc) => {      
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
  
});

