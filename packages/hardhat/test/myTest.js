const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

const contractName = "HodlPool";

use(solidity);

describe("My Dapp", function () {
  let myContract;

  describe(contractName, function () {
    it("Should deploy YourContract", async function () {
      const YourContract = await ethers.getContractFactory(contractName);

      myContract = await YourContract.deploy();
    });

    describe("setPurpose()", function () {
      it("Should be able to set a new purpose", async function () {
        const newPurpose = "Test Purpose";

        await myContract.setPurpose(newPurpose);
        expect(await myContract.purpose()).to.equal(newPurpose);
      });
    });
  });
});
