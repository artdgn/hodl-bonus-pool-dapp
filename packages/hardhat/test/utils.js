const { ethers, network, config } = require("hardhat");

class TestUtils {
    
    // all contract views in a single object
    static async getState(contract, tokenContract, depositId) {
        return {
            ...await this.depositDetails(contract, depositId), 
            ...await this.poolDetails(contract, tokenContract)
        }
    }

    // all contract views in a single object
    static async depositDetails(contract, depositId) {
        const depositDetails = await contract.depositDetails(depositId);
        const numToAddress = (v) => ethers.utils.getAddress(`0x${v.toHexString().slice(-40)}`);
        return {
            asset: numToAddress(depositDetails[0]),
            account: numToAddress(depositDetails[1]),
            balance: depositDetails[2],
            timeLeftToHold: depositDetails[3],
            penalty: depositDetails[4],
            holdBonus: depositDetails[5],
            commitBonus: depositDetails[6],
            holdPoints: depositDetails[7],
            commitPoints: depositDetails[8],
            initialPenaltyPercent: depositDetails[9],
            currentPenaltyPercent: depositDetails[10],
            commitPeriod: depositDetails[11],
        }
    }

    // all contract views in a single object
    static async poolDetails(contract, tokenContract) {
        const poolDetails = await contract.poolDetails(tokenContract.address);
        return {
            depositsSum: poolDetails[0],
            holdBonusesSum: poolDetails[1],
            commitBonusesSum: poolDetails[2],
            totalHoldPoints: poolDetails[3],
            totalCommitPoints: poolDetails[4],
        }
    }

    // all contract views in a single object
    static async depositsOfOwner(contract, signer) {
        const res = await contract.depositsOfOwner(signer.address);
        return {
            ids: res.tokenIds,
            assets: res.tokenIds,
        }       
    }

    // logging helper
    static logState(stateObj) {
        const numbersObj = Object.fromEntries(
            Object.entries(stateObj).map(v => {
                v[1] = v[1]?.toNumber ? v[1].toNumber() : v[1]; 
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

    static async lastDepositEvent(contract) {
        return (await contract.queryFilter(contract.filters.Deposited())).pop().args;
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
