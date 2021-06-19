const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

const contractName = "HodlPoolV2";
const wethContractName = "WETH";

use(solidity);

describe(`${contractName} deployment`, function () {

  let contract;
  let deployed;
  let owner;
  let addrs;

  const minInitialPenaltyPercent = 100;
  const minCommitPeriod = 10;
  const deployArgs = [minInitialPenaltyPercent, minCommitPeriod];

  beforeEach(async () => {
    [owner, ...addrs] = await ethers.getSigners();
    // deploy contract
    contract = await ethers.getContractFactory(contractName);

    // deploy WETH
    WETHContract = await ethers.getContractFactory(wethContractName);
    deployedWETH = await WETHContract.deploy();
  });

  describe("successful deployment", function () {

    beforeEach(async () => {
      deployed = await contract.deploy(...deployArgs, deployedWETH.address);
    });

    it("minInitialPenaltyPercent value", async function () {
      expect(await deployed.minInitialPenaltyPercent()).to.equal(deployArgs[0]);
    });

    it("minCommitPeriod value", async function () {
      expect(await deployed.minCommitPeriod()).to.equal(deployArgs[1]);
    });

    it("no receive or fallback", async function () {
      const tx = { to: deployed.address, value: 1000 };
      expect(addrs[0].sendTransaction(tx)).to.revertedWith("no receive");
    })
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

