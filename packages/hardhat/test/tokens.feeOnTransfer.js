const { ethers, network, config } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

const { TestUtils } = require("./utils.js")

const contractName = "HodlPoolV3";
const feeTokenContractName = "FeeToken";
const wethContractName = "WETH";
const utils = ethers.utils;

use(solidity);

describe(`${contractName} fee-on-transfer tokens`, function () {

  this.retries(3);  // some time dependant tests are flaky
  this.timeout(4000);  // some tests are slow in isolation (several interactions)
  
  let contract;
  let feeTokenContract;
  let deployed;
  let deployedFeeToken;
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
    
    // deploy a token with fees on transfer
    feeTokenContract = await ethers.getContractFactory(feeTokenContractName);
    deployedFeeToken = await feeTokenContract.deploy(
      "FeeToken", "FeeTK", addr1.address, utils.parseUnits("1", 18), tokenFeePercent);

    // deploy WETH
    WETHContract = await ethers.getContractFactory(wethContractName);
    deployedWETH = await WETHContract.deploy();

    // deploy contract
    contract = await ethers.getContractFactory(contractName);
    deployed = await contract.deploy(...deployArgs, deployedWETH.address);
  });

  describe("single account deposits & withdrawals", function () {
    let addr1Caller;

    beforeEach(async () => {
      addr1Caller = deployed.connect(addr1);
      addr1FeeTokenCaller = deployedFeeToken.connect(addr1);
    });

    it("withdraw and balances with fee-on-transfer token", async function () {
      const tx = 1000;
      const transferRatio = (100 - tokenFeePercent) / 100;
      // approve tokens
      await addr1FeeTokenCaller.approve(deployed.address, tx);

      // make deposits
      await addr1Caller.deposit(
        deployedFeeToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      const dep1 = (await TestUtils.lastDepositEvent(deployed)).tokenId;
      const state = await TestUtils.getState(deployed, deployedFeeToken, dep1);

      // check balanceOf()
      expect(state.balance).to.equal(tx * transferRatio);

      // check depositsSum
      expect(state.depositsSum).to.equal(tx * transferRatio);

      // check contract token balance
      expect(await deployedFeeToken.balanceOf(deployed.address))
        .to.equal(tx * transferRatio);

      // move time to be able to withdraw fully
      await TestUtils.evmIncreaseTime(minCommitPeriod);
      
      const withdrawal = await TestUtils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()),
        deployedFeeToken,
        async () => {
          await expect(addr1Caller.withdrawWithBonus(dep1))
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
      const dep1 = (await TestUtils.lastDepositEvent(deployed)).tokenId;

      // move time
      await TestUtils.evmIncreaseTime((minCommitPeriod / 2) - 1);
      
      const withdrawal1 = await TestUtils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedFeeToken,
        async () => {
          await expect(addr1Caller.withdrawWithPenalty(dep1))
            .to.emit(deployed, "Withdrawed");
        }
      );

      // should be able to withdraw but expect to pay token fee again
      expect(withdrawal1.lastEvent.amount).to.equal(tx * transferRatio / 2);
      expect(withdrawal1.delta).to.equal(tx * transferRatio * transferRatio / 2);  // due to second transfer

      const state = await TestUtils.poolDetails(deployed, deployedFeeToken);
      // check bonus pool
      expect(state.holdBonusesSum.add(state.commitBonusesSum))
        .to.equal(tx * transferRatio / 2)

      // deposit again
      await addr1FeeTokenCaller.approve(deployed.address, tx);
      await addr1Caller.deposit(
        deployedFeeToken.address, tx, minInitialPenaltyPercent, minCommitPeriod);
      const dep2 = (await TestUtils.lastDepositEvent(deployed)).tokenId;

      // move time
      await TestUtils.evmIncreaseTime(minCommitPeriod);

      const withdrawal2 = await TestUtils.callCaptureEventAndBalanceToken(
        addr1.address, 
        () => deployed.queryFilter(deployed.filters.Withdrawed()), 
        deployedFeeToken,
        async () => {
          await expect(addr1Caller.withdrawWithBonus(dep2))
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

});

