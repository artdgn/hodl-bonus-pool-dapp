const { ethers, network } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

const contractName = "HodlPool";

use(solidity);

describe(contractName, function () {
  let contract;
  let deployed;
  let owner;
  let addr1;
  let addr2;
  let addrs;
  const maxPenaltyPercent = 100;
  const commitPeriod = 10;
  const deployArgs = [maxPenaltyPercent, commitPeriod];

  beforeEach(async () => {
    contract = await ethers.getContractFactory(contractName);
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    deployed = await contract.deploy(...deployArgs);
  });

  describe("deployment", function () {

    describe("successful deployment public params", function () {
      it("maxDeposit value 1 ETH", async function () {
        expect(await deployed.maxDeposit()).to.equal(ethers.utils.parseEther("1.0"));
      });
      it("maxPenaltyPercent value", async function () {
        expect(await deployed.maxPenaltyPercent()).to.equal(deployArgs[0]);
      });
      it("commitPeriod value", async function () {
        expect(await deployed.commitPeriod()).to.equal(deployArgs[1]);
      });
    });

    describe("bad deployment params", function () {
      it("should not deploy maxPenaltyPercent > 100", async function () {
        const badArgs = [101, commitPeriod];
        expect(contract.deploy(...badArgs)).to.be.revertedWith("100%");
      });
      it("should not deploy commitPeriod < 10s", async function () {
        const badArgs = [maxPenaltyPercent, 2];
        expect(contract.deploy(...badArgs)).to.be.revertedWith("too short");
      });
      it("should not deploy commitPeriod > 365 days", async function () {
        const badArgs = [maxPenaltyPercent, 366 * 86400];
        expect(contract.deploy(...badArgs)).to.be.revertedWith("too long");
      });
    });

    it("deployment can be payable", async function () {
      paidDeployed = await contract.deploy(...deployArgs, { value: 1000 });
      expect(await ethers.provider.getBalance(paidDeployed.address)).to.equal(1000);
    });
  });

  describe("unsupported methods", function () {
    it("no receive or fallback", async function () {
      const tx = { to: deployed.address, value: 1000 };
      expect(addr1.sendTransaction(tx)).to.revertedWith("no receive");
    })
  });

  // advances EVM time into the future
  const evmIncreaseTime = async (seconds) => {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine");
  }

  describe("single account deposits & withdrawals", function () {
    let addr1Caller;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
    });

    it("can't deposit more than 1 ETH", async function () {
      const tooMuchEthTx = { value: ethers.utils.parseEther("1.001") };
      expect(addr1Caller.deposit(tooMuchEthTx)).to.revertedWith("too large");
    })

    it("can't withdrawWithBonus if didn't deposit", async function () {
      expect(addr1Caller.withdrawWithBonus()).to.revertedWith("nothing");
    });

    it("can't withdrawWithPenalty if didn't deposit", async function () {
      expect(addr1Caller.withdrawWithPenalty()).to.revertedWith("nothing");
    });

    it("can deposit twice", async function () {
      const tx = { value: 1000 };
      // deposit twice, check events emitted
      await expect(addr1Caller.deposit(tx)).to.emit(deployed, "Deposited");
      await expect(addr1Caller.deposit(tx)).to.emit(deployed, "Deposited");
      const txBlock = await ethers.provider.getBlockNumber();
      const expectedSum = tx.value * 2;
      // check balanceOf()
      expect(await deployed.balanceOf(addr1.address)).to.equal(expectedSum);
      // check depositsSum
      expect(await deployed.depositsSum()).to.equal(expectedSum);
      // check contract address balance
      expect(await ethers.provider.getBalance(deployed.address)).to.equal(expectedSum);
      // check event
      const filter = deployed.filters.Deposited();
      const lastEvent = (await deployed.queryFilter(filter, txBlock, txBlock))[0].args;
      const blockTimestamp = (await ethers.provider.getBlock(txBlock)).timestamp;
      expect(lastEvent.sender).to.equal(addr1.address);
      expect(lastEvent.amount).to.equal(tx.value);
      expect(lastEvent.time).to.equal(blockTimestamp);
    });

    it("penaltyOf & withdrawWithBonus with time passage", async function () {
      await addr1Caller.deposit({ value: 1000 });
      const depositBalance = await addr1Caller.balanceOf(addr1.address);

      // should be full penalty
      expect(await deployed.penaltyOf(addr1.address)).to.equal(depositBalance);

      // back to the future to 50% time
      evmIncreaseTime(commitPeriod / 2)
      let penalty = await deployed.penaltyOf(addr1.address);
      expect(penalty).to.equal(depositBalance / 2);

      // try to withdraw without penalty and fail
      await expect(addr1Caller.withdrawWithBonus()).to.revertedWith("penalty");
      
      // back to the future to 100% time
      evmIncreaseTime(commitPeriod / 2)
      penalty = await deployed.penaltyOf(addr1.address);
      expect(penalty).to.equal(0);

      // should be able to withdraw without penalty now
      const startBalance = await ethers.provider.getBalance(addr1.address);
      await expect(addr1Caller.withdrawWithBonus({ gasPrice: 0 }))
        .to.emit(deployed, "Withdrawed");
      const txBlock = await ethers.provider.getBlockNumber();
      const endBalance = await ethers.provider.getBalance(addr1.address);
      expect(endBalance.sub(startBalance)).to.equal(depositBalance);

      // check event
      const filter = deployed.filters.Withdrawed();
      const lastEvent = (await deployed.queryFilter(filter, txBlock, txBlock))[0].args;
      expect(lastEvent.sender).to.equal(addr1.address);
      expect(lastEvent.amount).to.equal(depositBalance);
      expect(lastEvent.penalty).to.equal(0);
      expect(lastEvent.bonus).to.equal(0);
      expect(lastEvent.timeHeld).to.gt(commitPeriod);

      // check can't withdraw any more
      expect(addr1Caller.withdrawWithPenalty()).to.revertedWith("nothing");
    });

    it("withdrawWithPenalty before commit period end", async function () {
      const tx = { value: 1000 };
      await addr1Caller.deposit(tx);

      // back to the future to 50% time
      evmIncreaseTime((commitPeriod / 2) - 1);  // write transaction will add some time

      // should be able to withdraw without penalty now
      const startBalance = await ethers.provider.getBalance(addr1.address);
      await expect(addr1Caller.withdrawWithPenalty({ gasPrice: 0 }))
        .to.emit(deployed, "Withdrawed");
      const txBlock = await ethers.provider.getBlockNumber();
      const endBalance = await ethers.provider.getBalance(addr1.address);
      expect(endBalance.sub(startBalance)).to.equal(tx.value / 2);

      // check event
      const filter = deployed.filters.Withdrawed();
      const lastEvent = (await deployed.queryFilter(filter, txBlock, txBlock))[0].args;
      expect(lastEvent.sender).to.equal(addr1.address);
      expect(lastEvent.amount).to.equal(tx.value / 2);
      expect(lastEvent.penalty).to.equal(tx.value / 2);
      expect(lastEvent.bonus).to.equal(0);
      expect(lastEvent.timeHeld).to.equal(commitPeriod / 2);

      // check can't withdraw any more
      expect(addr1Caller.withdrawWithPenalty()).to.revertedWith("nothing");
    });

  });

  describe("two accounts bonus behavior", function () {
    let addr1Caller;
    let addr2Caller;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
      addr2Caller = deployed.connect(addr2);
    });

    it("bonusOf & withdrawWithBonus & bonusesPool 1 penalty 1 bonus", async function () {
      const tx1 = { value: 1000 };
      const tx2 = { value: 2000 };
      await addr1Caller.deposit(tx1);
      await addr2Caller.deposit(tx2);

      // no bunus initially
      expect(await deployed.bonusOf(addr1.address)).to.equal(0);
      expect(await deployed.bonusOf(addr2.address)).to.equal(0);
      // check depositsSum
      expect(await deployed.depositsSum()).to.equal(tx1.value + tx2.value);

      // withdraw with penalty
      const startBalance1 = await ethers.provider.getBalance(addr1.address);
      await addr1Caller.withdrawWithPenalty({ gasPrice: 0 });
      const endBalance1 = await ethers.provider.getBalance(addr1.address);
      // check penalty was non-0
      const withdrawal1 = endBalance1.sub(startBalance1);
      const penalty1 = ethers.BigNumber.from(tx1.value).sub(withdrawal1);
      expect(penalty1).to.gt(0);

      // check bonus of 2 is penalty of 1
      expect(await deployed.bonusOf(addr2.address)).to.equal(penalty1);
      expect(await deployed.bonusesPool()).to.equal(penalty1);

      // check 2 can't withdraw with bonus too soon
      await expect(addr2Caller.withdrawWithBonus()).to.revertedWith("penalty");

      // move time
      evmIncreaseTime(commitPeriod);  

      // withdraw bonus
      const startBalance2 = await ethers.provider.getBalance(addr2.address);
      await addr2Caller.withdrawWithBonus({ gasPrice: 0 });
      const txBlock = await ethers.provider.getBlockNumber();
      const endBalance2 = await ethers.provider.getBalance(addr2.address);
      // check bonus
      const withdrawal2 = endBalance2.sub(startBalance2);
      const bonus2 = ethers.BigNumber.from(withdrawal2).sub(tx2.value);
      // check withdrawal of correct bonus amount
      expect(bonus2).to.equal(penalty1);

      // check event
      const filter = deployed.filters.Withdrawed();
      const lastEvent = (await deployed.queryFilter(filter, txBlock, txBlock))[0].args;
      expect(lastEvent.sender).to.equal(addr2.address);
      expect(lastEvent.amount).to.be.equal(withdrawal2);
      expect(lastEvent.penalty).to.equal(0);
      expect(lastEvent.bonus).to.be.equal(bonus2);
      expect(lastEvent.timeHeld).to.gt(commitPeriod);

      // check can't withdraw any more
      await expect(addr2Caller.withdrawWithPenalty()).to.revertedWith("nothing");
    });

    it("bonusOf & withdrawWithBonus 2 penalty 2 bonus", async function () {
      const tx = { value: 1000 };
      await addr1Caller.deposit(tx);
      
      // withdraw with penalty
      const startBalance1 = await ethers.provider.getBalance(addr1.address);
      await addr1Caller.withdrawWithPenalty({ gasPrice: 0 });
      const endBalance1 = await ethers.provider.getBalance(addr1.address);
      const withdrawal1 = endBalance1.sub(startBalance1);
      const penalty1 = ethers.BigNumber.from(tx.value).sub(withdrawal1);
      expect(penalty1).to.gt(0);

      // deposit as 2
      await addr2Caller.deposit(tx);
      // check 2 deserves bonus (if holds)
      expect(await deployed.bonusOf(addr2.address)).to.equal(penalty1);

      // check penalty is not affected by bonus and no bonus is withdrawn by 2
      const startBalance2 = await ethers.provider.getBalance(addr2.address);
      await addr2Caller.withdrawWithPenalty({ gasPrice: 0 });
      const endBalance2 = await ethers.provider.getBalance(addr2.address);
      const withdrawal2 = endBalance2.sub(startBalance2);
      const penalty2 = ethers.BigNumber.from(tx.value).sub(withdrawal2);
      expect(penalty2).to.be.equal(penalty1);
      expect(await deployed.bonusesPool()).to.be.equal(penalty1.add(penalty2));
    });

    it("bonusOf & withdrawWithBonus bonus divided correctly", async function () {
      const tx = { value: 1000 };
      await addr1Caller.deposit(tx);
      
      // withdraw with penalty
      await addr1Caller.withdrawWithPenalty();

      // deposit again as 1, and deposit as 2, but twice as much
      await addr1Caller.deposit(tx);
      await addr2Caller.deposit({value: tx.value * 2}); 

      // check 2 deserves bonus (if holds)
      const bonus1 = await deployed.bonusOf(addr1.address);
      expect(bonus1).to.gt(0);  // check deserves bonus
      // check bonuses are divided correctly
      expect(await deployed.bonusOf(addr2.address)).to.equal(bonus1.mul(2));  
      // check bonuses sum
      expect(await deployed.bonusesPool()).to.be.equal(bonus1.mul(3));

      // move time
      evmIncreaseTime(commitPeriod);

      // check actual withdrawal matches bonusOf
      const startBalance2 = await ethers.provider.getBalance(addr2.address);
      await addr2Caller.withdrawWithPenalty({ gasPrice: 0 });
      const endBalance2 = await ethers.provider.getBalance(addr2.address);
      const withdrawal2 = endBalance2.sub(startBalance2);
      expect(await withdrawal2.sub(bonus1.mul(2))).to.be.equal(tx.value * 2);      
    });    

  });

});
