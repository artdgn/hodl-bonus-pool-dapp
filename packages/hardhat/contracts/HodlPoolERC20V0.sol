//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// import "hardhat/console.sol";

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/IERC20.sol
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract HodlPoolERC20V0 {

  using SafeERC20 for IERC20;

  struct Deposit {
    uint value;
    uint time;
  }
  
  uint public immutable initialPenaltyPercent;  
  uint public immutable commitPeriod;
  IERC20 public immutable token;

  mapping(address => Deposit) internal deposits;  
  uint public depositsSum;
  uint public bonusesPool;

  event Deposited(address indexed sender, uint amount, uint time);
  event Withdrawed(
    address indexed sender, 
    uint amount, 
    uint depositAmount, 
    uint penalty, 
    uint bonus,
    uint timeHeld
  );

  modifier onlyDepositors() {
    require(deposits[msg.sender].value > 0, "no deposit");
    _;
  }

  constructor (uint initialPenaltyPercent_, uint commitPeriod_, address token_) {
    require(initialPenaltyPercent_ > 0, "no penalty"); 
    require(initialPenaltyPercent_ <= 100, "initial penalty > 100%"); 
    // TODO: remove the short commitment check (that's required for testing)
    require(commitPeriod_ >= 10 seconds, "commitment period too short");
    // require(commitPeriod_ >= 7 days, "commitment period too short");
    require(commitPeriod_ <= 365 days, "commitment period too long");
    initialPenaltyPercent = initialPenaltyPercent_;
    commitPeriod = commitPeriod_;
    token = IERC20(token_);
  }

  receive() external payable {
    revert("no receive())");
  }

  function deposit(uint amount) external {
    require(amount > 0, "deposit too small");
    // require(token.balanceOf(msg.sender) >= amount, "deposit amount larger than owned amount");  // testcase
    // require(token.allowance(msg.sender, address(this)) >= amount, "allowance too small");  // testcase
    deposits[msg.sender].value += amount;
    deposits[msg.sender].time = block.timestamp;
    depositsSum += amount;
    token.safeTransferFrom(msg.sender, address(this), amount); // testcase
    emit Deposited(msg.sender, amount, block.timestamp);
  }

  function withdrawWithBonus() external onlyDepositors {
    require(
      penaltyOf(msg.sender) == 0, 
      "cannot withdraw without penalty yet, use withdrawWithPenalty()"
    );
    _withdraw();
  }

  function withdrawWithPenalty() external onlyDepositors {
    _withdraw();
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

  function timeLeftToHoldOf(address sender) public view returns (uint) {
    if (balanceOf(sender) == 0) return 0;
    uint timeHeld = _depositTimeHeld(deposits[sender]);
    return (timeHeld < commitPeriod) ? (commitPeriod - timeHeld) : 0;
  }
  
  function _withdraw() internal {
    Deposit memory dep = deposits[msg.sender];

    // calculate penalty & bunus before making changes
    uint penalty = _depositPenalty(dep);
    // only get bonus if no penalty
    uint bonus = (penalty == 0) ? _depositBonus(dep) : 0;
    uint withdrawAmount = dep.value - penalty + bonus;

    // update state
    // remove deposit
    deposits[msg.sender] = Deposit(0, 0);
    // update total deposits
    depositsSum -= dep.value;
    // update bonus
    bonusesPool = bonusesPool + penalty - bonus;

    // transfer
    token.safeTransfer(msg.sender, withdrawAmount);    
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
    if (timeHeld >= commitPeriod) {
      return 0;
    } else {
      uint timeLeft = commitPeriod - timeHeld;
      // order important to prevent rounding to 0
      return ((dep.value * initialPenaltyPercent * timeLeft) / commitPeriod) / 100;
    }
  }

  function _depositBonus(Deposit memory dep) internal view returns (uint) {
    if (dep.value == 0 || bonusesPool == 0) {
      return 0;  // no luck
    } else {
      // order important to prevent rounding to 0
      return (bonusesPool * dep.value) / depositsSum;
    }
  }

}
