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

  before(async () => {
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

  describe("single account deposits & withdrawals", function () {
    let addr1Caller;

    before(async () => {
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

    const timeTravel = async (seconds) => {
      await network.provider.send("evm_increaseTime", [seconds]);
      await network.provider.send("evm_mine");
    }

    it("penaltyOf & withdrawWithBonus with time passage", async function () {
      await addr1Caller.deposit({ value: 1000 });
      const depositBalance = await addr1Caller.balanceOf(addr1.address);
      // should be full penalty
      expect(await deployed.penaltyOf(addr1.address)).to.equal(depositBalance);
      // back to the future to 50% time
      timeTravel(commitPeriod / 2)
      let penalty = await deployed.penaltyOf(addr1.address);
      expect(penalty).to.equal(depositBalance / 2);
      // try to withdraw without penalty and fail
      await expect(addr1Caller.withdrawWithBonus()).to.revertedWith("penalty");
      // back to the future to 100% time
      timeTravel(commitPeriod / 2)
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
      timeTravel((commitPeriod / 2) - 1);  // write transaction will add some time
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

  
  // 2 accounts, bonus mechanics

  // two deposits at the same time
  // check depositsSum

  // 1 bonusOf 0 initially
  // 1 withdrawWithPenalty 
  // 2 bonusOf > 0
  // 2 withdrawWithBonus reverts if too soon
  // 2 withdrawWithBonus has bonus after 10 seconds
  // emits correct event

  // similar scenario but not bonus with penalty


  // advanced: check calculations for penalties and bonuses

});
