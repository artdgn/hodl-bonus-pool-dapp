const { ethers, network, config } = require("hardhat");

class TestUtils {
    
    // all contract views in a single object
    static async getState(contract, tokenContract, signer) {
        const depositDetails = await contract.depositDetails(
            tokenContract.address, signer.address);
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

    // logging helper
    static logState(stateObj) {
        const numbersObj = Object.fromEntries(
            Object.entries(stateObj).map(v => {
                v[1] = v[1].toNumber(); 
                return v;
            }));
        console.log(numbersObj);
    }

    // advances EVM time into the future
    static evmIncreaseTime = async (seconds) => {
        await network.provider.send("evm_increaseTime", [seconds + 0.5]);
        await network.provider.send("evm_mine");
    }

    // runs transactions and checks token balance difference and last event
    static async callCaptureEventAndBalanceToken(
        address, eventQuery, tokenContract, callsFunc
    ) {
        const startBalance = await tokenContract.balanceOf(address);
        await callsFunc();  // run the transactions
        const endBalance = await tokenContract.balanceOf(address);
        const lastEvent = (await eventQuery()).pop().args;
        return {
            delta: endBalance.sub(startBalance),
            lastEvent,
        };
    }

    // runs transactions and checks ETH balance difference and last event
    static async callCaptureEventAndBalanceETH(
        address, eventQuery, callsFunc
    ) {
        const startBalance = await ethers.provider.getBalance(address);
        await callsFunc();  // run the transactions
        const endBalance = await ethers.provider.getBalance(address);
        // event
        const lastEvent = (await eventQuery()).pop().args;
        return {
            delta: endBalance.sub(startBalance),
            lastEvent,
        };
    }
}

module.exports = { TestUtils }
