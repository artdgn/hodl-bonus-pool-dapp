//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// import "hardhat/console.sol";  // TODO: remove

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract HodlPoolV2 {

  using SafeERC20 for IERC20;

  struct Deposit {
    uint value;
    uint time;
    uint initialPenaltyPercent;
    uint commitPeriod;
    uint prevHoldPoints;  // to carry over hold time credit from unfinished deposit
    uint commitPoints; // to store commit time points
  }

  struct Pool {
    uint depositsSum;
    uint holdBonusesSum;
    uint commitBonusesSum;
    uint totalHoldPoints;
    uint totalHoldPointsUpdateTime;
    uint totalCommitPoints;
  }
  
  // TODO: pass in deposit
  uint public immutable minInitialPenaltyPercent;  

  uint public immutable minCommitPeriod;

  address public immutable WETH;

  mapping(address => Pool) internal pools;  

  mapping(address => mapping(address => Deposit)) internal deposits;  

  event Deposited(
    address indexed token, 
    address indexed sender, 
    uint amount, 
    uint amountReceived, 
    uint time,
    uint initialPenaltyPercent,
    uint commitPeriod
  );

  event Withdrawed(
    address indexed token,
    address indexed sender, 
    uint amount, 
    uint depositAmount, 
    uint penalty, 
    uint holdBonus,
    uint commitBonus,
    uint timeHeld
  );

  modifier onlyDepositors(address token) {
    require(deposits[token][msg.sender].value > 0, "no deposit");
    _;
  }

  constructor (uint _minInitialPenaltyPercent, uint _minCommitPeriod, address _WETH) {
    require(_minInitialPenaltyPercent > 0, "no penalty"); 
    require(_minInitialPenaltyPercent <= 100, "minimum initial penalty > 100%"); 
    require(_minCommitPeriod >= 10 seconds, "minimum commitment period too short");
    require(_minCommitPeriod <= 365 days, "minimum commitment period too long");
    require(_WETH != address(0), "WETH address can't be 0x0");
    minInitialPenaltyPercent = _minInitialPenaltyPercent;
    minCommitPeriod = _minCommitPeriod;
    WETH = _WETH;
  }

  receive() external payable {
    require(
      msg.sender == WETH, 
      "no receive() except from WETH contract, use depositETH()");
  }

  //////// PUBLIC TRANSACTIONS

  function deposit(address token, uint amount) external {
    require(amount > 0, "deposit too small");

    // interal accounting update
    _depositStateUpdate(
      token, 
      amount,
      minInitialPenaltyPercent, 
      minCommitPeriod
    );

    // this contract's balance before the transfer
    uint beforeBalance = IERC20(token).balanceOf(address(this));

    // transfer
    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

    // what was actually received
    uint amountReceived = IERC20(token).balanceOf(address(this)) - beforeBalance;

    emit Deposited(
      token,
      msg.sender, 
      amount, 
      amountReceived, 
      block.timestamp, 
      minInitialPenaltyPercent, 
      minCommitPeriod
    );
  }

  function depositETH() external payable {
    require(msg.value > 0, "deposit too small");

    // interal accounting update
    _depositStateUpdate(
      WETH, 
      msg.value,
      minInitialPenaltyPercent, 
      minCommitPeriod
    );

    // note: no share vs. balance accounting for WETH because it's assumed to
    // exactly correspond to actual deposits and withdrawals (no fee-on-transfer etc)
    IWETH(WETH).deposit{value: msg.value}();
    emit Deposited(
      WETH, 
      msg.sender, 
      msg.value, 
      msg.value, 
      block.timestamp, 
      minInitialPenaltyPercent, 
      minCommitPeriod
    );
  }
  
  function withdrawWithBonus(address token) external onlyDepositors(token) {
    require(
      _depositPenalty(deposits[token][msg.sender]) == 0, 
      "cannot withdraw without penalty yet, use withdrawWithPenalty()"
    );
    _withdraw(token);
  }

  function withdrawWithBonusETH() external onlyDepositors(WETH) {
    require(
      _depositPenalty(deposits[WETH][msg.sender]) == 0, 
      "cannot withdraw without penalty yet, use withdrawWithPenalty()"
    );
    _withdrawETH();
  }

  function withdrawWithPenalty(address token) external onlyDepositors(token) {
    _withdraw(token);
  }

  function withdrawWithPenaltyETH() external onlyDepositors(WETH) {
    _withdrawETH();
  }

  //////// PUBLIC VIEWs

  function depositDetails(
    address token, address sender
  ) public view returns (uint[10] memory) {
    Deposit storage dep = deposits[token][sender];
    return [
      _shareToAmount(token, dep.value),  // balance
      _timeLeft(deposits[token][sender]),  // timeLeftToHold
      _shareToAmount(token, _depositPenalty(dep)),  // penalty
      _shareToAmount(token, _holdBonus(pools[token], dep)),  // holdBonus
      _shareToAmount(token, _commitBonus(pools[token], dep)),  // commitBonus
      _holdPoints(dep),  // holdPoints
      dep.commitPoints,  // commitPoints
      dep.initialPenaltyPercent,  // initialPenaltyPercent
      _currentPenaltyPercent(dep),  // currentPenaltyPercent
      dep.commitPeriod  // commitPeriod
    ];
  }

  function poolDetails(address token) public view returns (uint[5] memory) {
    Pool storage pool = pools[token];
    return [
      _shareToAmount(token, pool.depositsSum),  // depositsSum
      _shareToAmount(token, pool.holdBonusesSum),  // holdBonusesSum
      _shareToAmount(token, pool.commitBonusesSum),  // commitBonusesSum
      _totalHoldPoints(pool),  // totalHoldPoints
      pool.totalCommitPoints  // totalCommitPoints
    ];
  }

  ////// INTERNAL TRANSACTIONS

  function _depositStateUpdate(
    address token, 
    uint amount, 
    uint initialPenaltyPercent, 
    uint commitPeriod
  ) internal {            
    // testcases
    require(initialPenaltyPercent > 0, "no penalty");  
    require(initialPenaltyPercent <= 100, "initial penalty > 100%"); 
    require(commitPeriod >= 10 seconds, "commitment period too short");
    require(commitPeriod <= 365 days, "commitment period too long");    

    // possible commit points that will need to be subtracted from deposit and pool
    uint commitPointsToSubtract = 0; 

    // deposit updates
    Deposit storage dep = deposits[token][msg.sender];        
    if (dep.value > 0) {  // adding to previous deposit      
      require(
        initialPenaltyPercent >= _currentPenaltyPercent(dep), 
        "add deposit: penalty percent less than existing deposits's percent"
      );  // testcase
      require(
        commitPeriod >= _timeLeft(dep),
        "add deposit: commit period less than existing deposit's time left"
      );  // testcase

      // carry over previous points and add points for the time 
      // held since latest deposit
      // WARNING: this needs to happen before deposit value is updated
      dep.prevHoldPoints = _holdPoints(dep);
      
      // this value will need to be sutracted from both deposit and pool's points
      commitPointsToSubtract = _outstandingCommitPoints(dep);
      // subtract un-held commitment from commit points
      dep.commitPoints -= commitPointsToSubtract;
    }

    // deposit update for both new & existing
    dep.value += amount;  // add the amount
    dep.time = block.timestamp;  // set the time
    // set the commitment params
    dep.commitPeriod = commitPeriod;  
    dep.initialPenaltyPercent = initialPenaltyPercent;
    // add full commitment points for commitment holdBonus calculations
    dep.commitPoints += _fullCommitPoints(dep);  

    // pool update
    Pool storage pool = pools[token];
    // update pool's total hold time due to passage of time
    // because the deposits sum is going to change
    _updatePoolHoldPoints(pool);
    // WARNING: the deposits sum needs to be updated after the hold-points
    // for the passed time were updated
    pool.depositsSum += amount;    
    // the full new amount is committed minus any commit points that need to be sutracted
    pool.totalCommitPoints -= commitPointsToSubtract;
    pool.totalCommitPoints += _fullCommitPoints(dep);
  }

  // this happens on every pool interaction (so every withdrawal and deposit to that pool)
  function _updatePoolHoldPoints(Pool storage pool) internal {
    // add points proportional to value held in pool since last update
    pool.totalHoldPoints = _totalHoldPoints(pool);    
    pool.totalHoldPointsUpdateTime = block.timestamp;
  }  
  
  function _withdraw(address token) internal {
    uint withdrawAmount = _withdrawAmountAndUpdate(token);
    IERC20(token).safeTransfer(msg.sender, withdrawAmount);
  }

  function _withdrawETH() internal {
    uint withdrawAmount = _withdrawAmountAndUpdate(WETH);
    IWETH(WETH).withdraw(withdrawAmount);
    payable(msg.sender).transfer(withdrawAmount);
  }
  
  function _withdrawAmountAndUpdate(address token) internal returns (uint) {
    Pool storage pool = pools[token];
    // update pool hold-time points due to passage of time
    // WARNING: failing to do so will break hold-time holdBonus calculation
    _updatePoolHoldPoints(pool);

    // WARNING: deposit is only read here and is not updated until it's removal
    Deposit storage dep = deposits[token][msg.sender];

    // calculate penalty & bunus before making changes
    uint penalty = _depositPenalty(dep);
    
    // only get any bonuses if no penalty
    uint holdBonus = (penalty == 0) ? _holdBonus(pool, dep) : 0;
    uint commitBonus = (penalty == 0) ? _commitBonus(pool, dep) : 0;
    uint withdrawShare = dep.value - penalty + holdBonus + commitBonus;    

    // WARNING: get amount here before state is updated
    uint withdrawAmount = _shareToAmount(token, withdrawShare);

    // WARNING: emit event here with all the needed data, before states updates
    // affect shareToAmount calculations
    // this refactor is needed for handling stack-too-deep error because for some
    // reason just putting it in its own scope didn't help
    _emitWithdrawalEvent(token, dep, penalty, holdBonus, commitBonus, withdrawAmount);

    // pool state update
    // WARNING: should happen after calculating shares, because the depositSum changes
    // update pool state        
    // update total deposits
    pool.depositsSum -= dep.value;        
    // remove the acrued hold-points for this deposit
    pool.totalHoldPoints -= _holdPoints(dep);
    // remove the commit-points
    pool.totalCommitPoints -= dep.commitPoints;
    // update hold-bonus pool
    // split the penalty into two parts
    // half for hold bonuses, half for commit bonuses
    uint holdBonusPoolUpdate = penalty / 2;
    uint commitBonusPoolUpdate = penalty - holdBonusPoolUpdate;
    pool.holdBonusesSum = pool.holdBonusesSum + holdBonusPoolUpdate - holdBonus;
    // update commitBonus pool
    pool.commitBonusesSum = pool.holdBonusesSum + commitBonusPoolUpdate - commitBonus;  

    // remove deposit
    // WARNING: note that removing the deposit before this line will 
    // change "dep" because it's used by reference and will affect the other
    // computations for pool state updates (e.g. hold points)
    delete deposits[token][msg.sender];

    return withdrawAmount;
  }

  function _emitWithdrawalEvent(
    address token, 
    Deposit storage dep,
    uint penalty,
    uint holdBonus,
    uint commitBonus,
    uint withdrawAmount
  ) internal {  
    emit Withdrawed(
      token,
      msg.sender,
      withdrawAmount, 
      dep.value, 
      _shareToAmount(token, penalty), 
      _shareToAmount(token, holdBonus), 
      _shareToAmount(token, commitBonus), 
      _timeHeld(dep));
  }

  ////// INTERNAL VIEWS

  function _timeLeft(Deposit storage dep) internal view returns (uint) {
    if (dep.value == 0) { // division by zero
      return 0; 
    } else {
      uint timeHeld = _timeHeld(dep);
      return (timeHeld < dep.commitPeriod) ? (dep.commitPeriod - timeHeld) : 0;
    }
  }

  function _shareToAmount(address token, uint share) internal view returns (uint) {
    // all tokens that belong to this contract are either 
    // in deposits or in the two bonuses pools
    Pool storage pool = pools[token];
    uint totalShares = pool.depositsSum + pool.holdBonusesSum + pool.commitBonusesSum;
    if (totalShares == 0) {  // don't divide by zero
      return 0;  
    } else {
      // it's safe to call external balanceOf here because 
      // it's a view (and this method is also view)
      uint actualBalance = IERC20(token).balanceOf(address(this));      
      return actualBalance * share / totalShares;
    }
  }
  
  function _holdPoints(Deposit storage dep) internal view returns (uint) {
    // points proportional to value held since deposit start    
    return dep.prevHoldPoints + (dep.value * _timeHeld(dep));
  }

  function _totalHoldPoints(Pool storage pool) internal view returns (uint) {
    uint elapsed = block.timestamp - pool.totalHoldPointsUpdateTime;
    // points proportional to value held in pool since last update
    return pool.totalHoldPoints + (pool.depositsSum * elapsed);
  }

  function _fullCommitPoints(Deposit storage dep) internal view returns (uint) {
    // triangle area of commitpent time and penalty
    return (
      dep.value * dep.initialPenaltyPercent * dep.commitPeriod
      / 100 / 2
    );
  }

  function _outstandingCommitPoints(Deposit storage dep) internal view returns (uint) {
    // triangle area of commitpent time and penalty
    uint timeLeft = _timeLeft(dep);
    if (timeLeft == 0) {
      return 0;
    } else {      
      // smaller triangle of left commitment time left * smaller penalty left
      // can refactor to use _currentPenaltyPercent() here, but it's better for precision
      // to do all multiplications before all divisions
      return (
        dep.value * dep.initialPenaltyPercent * timeLeft * timeLeft / 
        (dep.commitPeriod * 100 * 2)  // triangle area
      );
    }
  }

  function _currentPenaltyPercent(Deposit storage dep) internal view returns (uint) {
    uint timeLeft = _timeLeft(dep);
    if (timeLeft == 0) {
      return 0;
    } else {
      // current penalty percent is proportional to time left
      uint curPercent = (dep.initialPenaltyPercent * timeLeft) / dep.commitPeriod;
      // if calculation was rounded down to 0 (can happen towards end of term), return 1
      return curPercent > 0 ? curPercent : 1;  // testcase
    }
  }

  function _timeHeld(Deposit storage dep) internal view returns (uint) {
    return block.timestamp - dep.time;
  }

  function _depositPenalty(Deposit storage dep) internal view returns (uint) {
    uint timeLeft = _timeLeft(dep);
    if (timeLeft == 0) {
      return 0;
    } else {
      // order important to prevent rounding to 0
      return (
        (dep.value * dep.initialPenaltyPercent * timeLeft) 
        / dep.commitPeriod) 
        / 100;
    }
  }

  function _holdBonus(
    Pool storage pool, 
    Deposit storage dep
  ) internal view returns (uint) {
    if (dep.value == 0 || pool.holdBonusesSum == 0) {
      return 0;  // no luck
    } else {
      // share of bonus is proportional to hold-points of this deposit relative
      // to total hold-points in the pool
      // order important to prevent rounding to 0
      return (pool.holdBonusesSum * _holdPoints(dep)) / _totalHoldPoints(pool);
    }
  }

  function _commitBonus(
    Pool storage pool, 
    Deposit storage dep
  ) internal view returns (uint) {
    if (dep.value == 0 || pool.commitBonusesSum == 0) {
      return 0;  // no luck
    } else {
      // share of bonus is proportional to commit-points of this deposit relative
      // to all other commit-points in the pool
      // order important to prevent rounding to 0
      return (pool.commitBonusesSum * dep.commitPoints) / pool.totalCommitPoints;
    }
  }

}

/// @dev interface for interacting with WETH (wrapped ether) for handling ETH
/// https://github.com/Uniswap/uniswap-v2-periphery/blob/master/contracts/interfaces/IWETH.sol
interface IWETH {
  function deposit() external payable;
  function transfer(address to, uint value) external returns (bool);
  function withdraw(uint) external;
}
