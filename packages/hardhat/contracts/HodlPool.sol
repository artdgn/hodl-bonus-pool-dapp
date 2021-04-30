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
  event Withdrawal(
    address sender, 
    uint amount, 
    uint depositAmount, 
    uint penalty, 
    uint bonus,
    uint timeHeld
  );

  // consts
  uint public constant maxDeposit = 1 ether;
  // init
  uint public immutable maxPenaltyPercent;
  uint public immutable commitPeriod;
  // state
  mapping(address => Deposit) internal deposits;
  // all funds are represented by this.balance
  uint public bonusesPool;
  uint public depositsSum;

  constructor (uint maxPenaltyPercent_, uint commitPeriod_) payable {
     // todo: test cases: illegal values
    require(maxPenaltyPercent_ <= 100, "max penalty > 100%"); 
    require(commitPeriod_ >= 10 seconds, "commitment period too short");
    // require(commitPeriod_ >= 7 days, "commitment period too short");
    require(commitPeriod_ <= 365 days, "commitment period too long");
    maxPenaltyPercent = maxPenaltyPercent_;
    commitPeriod = commitPeriod_;
    // possible "seed" for bonuses pool
    bonusesPool = msg.value;
  }

  receive() external payable {
    // todo: testcase send eth
    revert("no receive(), use deposit()");
  }

  fallback() external payable {
    // todo: testcase call unknown metho
    revert("no fallback(), use deposit()");
  }

  function deposit() external payable {
    // todo: testcase try to deposit too much
    require(msg.value <= maxDeposit, "deposit too large");
    // todo: tescase deposit twice
    require(deposits[msg.sender].value == 0, "already deposited");
    deposits[msg.sender] = Deposit(msg.value, block.timestamp);
    depositsSum += msg.value;
    emit ReceivedDeposit(msg.sender, msg.value, block.timestamp);
    assert (address(this).balance == depositsSum + bonusesPool);  // assert accounting
  }

  function depositOf(address sender) external view returns (uint) {
    // todo: testcase check works
    return deposits[sender].value;
  }

  function withdraw() external {
    // todo: testcase withdraw without depositing, withdraw twice
    Deposit memory dep = deposits[msg.sender];
    require(dep.value > 0, "nothing to withdraw");

    // calculate penalty & bunus before making changes
    // todo: testcase penalty for time held - 0, 50%, 100%, 150%
    uint penalty = depositPenalty(dep);
    // only get bonus if no penalty
    // todo: testcase, no bunus if penalty
    // todo: testcase, bonus divided correctly between holders
    uint bonus = (penalty == 0) ? depositBonus(dep) : 0;
    uint withdrawAmount = dep.value - penalty + bonus;

    // update state
    // remove deposit
    deposits[msg.sender] = Deposit(0, 0);
    depositsSum -= dep.value;
    // add penalty to bonuses or subtract paid bonus
    bonusesPool = bonusesPool + penalty - bonus;  // order important to prevent underflow

    // withdraw
    payable(msg.sender).transfer(withdrawAmount);
    assert (address(this).balance == depositsSum + bonusesPool);  // double check accounting
    emit Withdrawal(
      msg.sender,
      withdrawAmount, 
      dep.value, 
      penalty, 
      bonus, 
      depositTimeHeld(dep));
  }

  function penaltyOf(address sender) external view returns (uint) {
    return depositPenalty(deposits[sender]);
  }

  function bonusOf(address sender) external view returns (uint) {
    return depositBonus(deposits[sender]);
  }

  function depositTimeHeld(Deposit memory dep) internal view returns (uint) {
    return block.timestamp - dep.time;
  }

  function depositPenalty(Deposit memory dep) internal view returns (uint) {
    uint timeHeld = depositTimeHeld(dep);
    assert (timeHeld >= 0);  // can't have deposited in future
    if (timeHeld >= commitPeriod) {
      return 0;
    } else {
      uint timeLeft = commitPeriod - timeHeld;
      // order important to prevent rounding to 0
      return ((dep.value * maxPenaltyPercent * timeLeft) / commitPeriod) / 100;
    }
  }

  function depositBonus(Deposit memory dep) internal view returns (uint) {
    if (dep.value == 0 || bonusesPool == 0) {
      return 0;  // no luck
    } else {
      assert (depositsSum > 0);  // could only get here if something was deposited
      // order important to prevent rounding to 0
      return (bonusesPool * dep.value) / depositsSum;
    }
  }





}
