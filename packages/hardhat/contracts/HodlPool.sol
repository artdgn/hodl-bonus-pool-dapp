//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "hardhat/console.sol";
//import "@openzeppelin/contracts/access/Ownable.sol"; //https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol

contract HodlPool {

  struct Deposit {
    uint value;
    uint time;
  }

  event ReceivedDeposit(address sender, uint amount, uint time);
  event Withdrawal(address sender, uint amount, uint depositAmount);

  // consts
  uint public constant maxDeposit = 1 ether;
  // init
  uint public immutable maxPenaltyPercent;
  uint public immutable commitPeriod;
  // state
  mapping(address => Deposit) internal deposits;
  // reward pool is represented by this.balance

  constructor (uint maxPenaltyPercent_, uint commitPeriod_) {
     // todo: test cases: illegal values
    require(maxPenaltyPercent_ <= 100, "max penalty > 100%"); 
    require(commitPeriod_ >= 10 seconds, "commitment period too short");
    // require(commitPeriod_ >= 7 days, "commitment period too short");
    require(commitPeriod_ <= 365 days, "commitment period too long");
    maxPenaltyPercent = maxPenaltyPercent_;
    commitPeriod = commitPeriod_;
  }

  receive() external payable {
    // todo: testcase send eth
    revert("no receive(), use deposit()");
  }

  fallback() external payable {
    // todo: testcase call unknown metho
    revert("no fallback(), use deposit()");
  }

  function rewardsPool() external view returns(uint) {
    // todo: testcase check value
    return address(this).balance;
  }

  function deposit() external payable {
    // todo: testcase try to deposit too much
    require(msg.value <= maxDeposit, "deposit too large");
    // todo: tescase deposit twice
    require(deposits[msg.sender].value == 0, "already deposited");
    deposits[msg.sender] = Deposit(msg.value, block.timestamp);
    emit ReceivedDeposit(msg.sender, msg.value, block.timestamp);
  }

  function depositOf(address sender) external view returns (uint) {
    // todo: testcase check works
    return deposits[sender].value;
  }

  function withdraw() external {
    // todo: testcase withdraw without depositing, withdraw twice
    Deposit memory dep = deposits[msg.sender];
    require(dep.value > 0, "nothing to withdraw");
    deposits[msg.sender] = Deposit(0, 0);
    payable(msg.sender).transfer(dep.value);
    emit Withdrawal(msg.sender, dep.value, dep.value);
  }
  




}
