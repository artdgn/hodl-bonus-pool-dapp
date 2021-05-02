//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "hardhat/console.sol";
//import "@openzeppelin/contracts/access/Ownable.sol"; //https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol

contract HodlPool {

  struct Deposit {
    uint value;
    uint time;
  }

  event Deposited(address sender, uint amount, uint time);
  
  event Withdrawed(
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
  uint public depositsSum;

  // payable to enable seeding the contract's bonus pool
  constructor (uint maxPenaltyPercent_, uint commitPeriod_) payable {
    require(maxPenaltyPercent_ <= 100, "max penalty > 100%"); 
    require(commitPeriod_ >= 10 seconds, "commitment period too short");
    // require(commitPeriod_ >= 7 days, "commitment period too short");
    require(commitPeriod_ <= 365 days, "commitment period too long");
    maxPenaltyPercent = maxPenaltyPercent_;
    commitPeriod = commitPeriod_;
  }

  receive() external payable {
    revert("no receive(), use deposit()");
  }

  function deposit() external payable {
    require(msg.value <= maxDeposit, "deposit too large");
    deposits[msg.sender].value += msg.value;
    deposits[msg.sender].time = block.timestamp;
    depositsSum += msg.value;
    emit Deposited(msg.sender, msg.value, block.timestamp);
  }

  function withdrawWithBonus() external {
    require(deposits[msg.sender].value > 0, "nothing to withdraw");
    require(penaltyOf(msg.sender) == 0, "cannot withdraw without penalty yet");
    _withdraw();
  }

  function withdrawWithPenalty() external {
    require(deposits[msg.sender].value > 0, "nothing to withdraw");
    _withdraw();
  }

  function bonusesPool() public view returns (uint) {
    // anything not in deposits sum is bonus, e.g. including anything force-sent to contract
    return address(this).balance - depositsSum;
  }

  function balanceOf(address sender) public view returns (uint) {
    return deposits[sender].value;
  }

  function penaltyOf(address sender) public view returns (uint) {
    return _depositPenalty(deposits[sender]);
  }

  function bonusOf(address sender) public view returns (uint) {
    return _depositBonus(deposits[sender]);
  }
  
  function _withdraw() internal {
    Deposit memory dep = deposits[msg.sender];
    require(dep.value > 0, "nothing to withdraw");

    // calculate penalty & bunus before making changes
    // todo: testcase penalty for time held - 0, 50%, 100%, 150%
    uint penalty = _depositPenalty(dep);
    // only get bonus if no penalty
    uint bonus = (penalty == 0) ? _depositBonus(dep) : 0;
    uint withdrawAmount = dep.value - penalty + bonus;

    // update state
    // remove deposit
    deposits[msg.sender] = Deposit(0, 0);
    depositsSum -= dep.value;

    // transfer
    payable(msg.sender).transfer(withdrawAmount);    
    emit Withdrawed(
      msg.sender,
      withdrawAmount, 
      dep.value, 
      penalty, 
      bonus, 
      _depositTimeHeld(dep));
  }

  function _depositTimeHeld(Deposit memory dep) internal view returns (uint) {
    return block.timestamp - dep.time;
  }

  function _depositPenalty(Deposit memory dep) internal view returns (uint) {
    uint timeHeld = _depositTimeHeld(dep);
    assert (timeHeld >= 0);  // can't have deposited in future
    if (timeHeld >= commitPeriod) {
      return 0;
    } else {
      uint timeLeft = commitPeriod - timeHeld;
      // order important to prevent rounding to 0
      return ((dep.value * maxPenaltyPercent * timeLeft) / commitPeriod) / 100;
    }
  }

  function _depositBonus(Deposit memory dep) internal view returns (uint) {
    if (dep.value == 0 || bonusesPool() == 0) {
      return 0;  // no luck
    } else {
      assert (depositsSum > 0);  // could only get here if something was deposited
      // order important to prevent rounding to 0
      return (bonusesPool() * dep.value) / depositsSum;
    }
  }

}
