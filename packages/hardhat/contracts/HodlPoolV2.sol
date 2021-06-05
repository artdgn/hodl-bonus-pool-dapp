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
    uint prevHoldTimeCredits;  // to carry over hold time credit from unfinished deposit
    // uint commitTimeCredits; // to carry over commit time credit from unfinished deposit
  }

  struct Pool {
    uint depositSum;
    uint bonusSum;
    uint totalHoldTimeCredits;
    uint updateTime;
    //uint bonusSumCommitment
    //uint totalCommitTimeCredits;
  }
  
  // TODO: pass in deposit
  uint public immutable defaultInitialPenaltyPercent;  

  uint public immutable defaultCommitPeriod;

  address public immutable WETH;

  mapping(address => Pool) internal pools;  

  // this keeps the structs shallow and causes fewer troubles with 
  // assignments as reference and data location
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
    uint bonus,
    uint timeHeld
  );

  modifier onlyDepositors(address token) {
    require(deposits[token][msg.sender].value > 0, "no deposit");
    _;
  }

  constructor (uint _defaultInitialPenaltyPercent, uint _defaultCommitPeriod, address _WETH) {
    require(_defaultInitialPenaltyPercent > 0, "no penalty"); 
    require(_defaultInitialPenaltyPercent <= 100, "initial penalty > 100%"); 
    require(_defaultCommitPeriod >= 10 seconds, "commitment period too short");
    require(_defaultCommitPeriod <= 365 days, "commitment period too long");
    require(_WETH != address(0), "WETH address can't be 0x0");
    defaultInitialPenaltyPercent = _defaultInitialPenaltyPercent;
    defaultCommitPeriod = _defaultCommitPeriod;
    WETH = _WETH;
  }

  receive() external payable {
    require(
      msg.sender == WETH, 
      "no receive() except from WETH contract, use depositETH()");
  }

  function deposit(address token, uint amount) external {
    require(amount > 0, "deposit too small");

    // interal accounting update
    _depositUpdate(
      token, 
      amount,
      defaultInitialPenaltyPercent, 
      defaultCommitPeriod
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
      defaultInitialPenaltyPercent, 
      defaultCommitPeriod
    );
  }

  function depositETH() external payable {
    require(msg.value > 0, "deposit too small");

    // interal accounting update
    _depositUpdate(
      WETH, 
      msg.value,
      defaultInitialPenaltyPercent, 
      defaultCommitPeriod
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
      defaultInitialPenaltyPercent, 
      defaultCommitPeriod
    );
  }
  
  function withdrawWithBonus(address token) external onlyDepositors(token) {
    require(
      penaltyOf(token, msg.sender) == 0, 
      "cannot withdraw without penalty yet, use withdrawWithPenalty()"
    );
    _withdraw(token);
  }

  function withdrawWithBonusETH() external onlyDepositors(WETH) {
    require(
      penaltyOf(WETH, msg.sender) == 0, 
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

  function balanceOf(address token, address sender) public view returns (uint) {
    return _shareToAmount(token, deposits[token][sender].value);
  }

  function penaltyOf(address token, address sender) public view returns (uint) {
    uint penaltyShare =_depositPenalty(deposits[token][sender]);
    return _shareToAmount(token, penaltyShare);
  }

  function bonusOf(address token, address sender) public view returns (uint) {
    Pool storage pool = pools[token];
    uint bonusShare = _depositBonus(pool, deposits[token][sender]);
    return _shareToAmount(token, bonusShare);
  }

  function depositsSum(address token) public view returns (uint) {
    return _shareToAmount(token, pools[token].depositSum);
  }

  function bonusesPool(address token) public view returns (uint) {
    return _shareToAmount(token, pools[token].bonusSum);
  }

  function holdTimeCredits(address token, address sender) public view returns (uint) {
    return _holdTimeCredits(deposits[token][sender]);
  }

  function totalHoldTimeCredits(address token) public view returns (uint) {
    return _totalHoldTimeCredits(pools[token]);
  }

  function timeLeftToHold(
    address token, address sender
  ) public view returns (uint) {
    if (balanceOf(token, sender) == 0) {
      return 0;
    } else {
      Deposit storage dep = deposits[token][sender];
      uint timeHeld = _depositTimeHeld(dep);
      return (timeHeld < dep.commitPeriod) ? (dep.commitPeriod - timeHeld) : 0;
    }
  }

  function _shareToAmount(address token, uint share) internal view returns (uint) {
    // all tokens that belong to this contract are either in deposits or in bonus pool
    Pool storage pool = pools[token];
    uint totalShares = pool.depositSum + pool.bonusSum;
    if (totalShares == 0) {  // don't divide by zero
      return 0;  
    } else {
      // it's safe to call external balanceOf here because 
      // it's a view (and this method is also view)
      uint actualBalance = IERC20(token).balanceOf(address(this));      
      return actualBalance * share / totalShares;
    }
  }

  function _depositUpdate(
    address token, 
    uint amount, 
    uint initialPenaltyPercent, 
    uint commitPeriod
  ) internal {    
    
    //// update deposit    
    Deposit storage dep = deposits[token][msg.sender];    
    // carry over previous credits and add credits for the time 
    // held since latest reset
    // CAREFUL: this needs to happen before value is updated
    dep.prevHoldTimeCredits = _holdTimeCredits(dep);
    // add new deposit
    dep.value += amount;
    // reset these values
    dep.time = block.timestamp;
    dep.initialPenaltyPercent = initialPenaltyPercent;
    dep.commitPeriod = commitPeriod;

    //// update pool
    Pool storage pool = pools[token];
    _updatePoolHoldTimeCredits(pool);
    pool.depositSum += amount;    
  }

  function _holdTimeCredits(Deposit storage dep) internal view returns (uint) {
    // credits proportional to value held since deposit start
    return dep.prevHoldTimeCredits + (dep.value * (block.timestamp - dep.time));
  }

  // this happens on every pool interaction (so every withdrawal and deposit to that pool)
  function _updatePoolHoldTimeCredits(Pool storage pool) internal {
    // add credits proportional to value held in pool since last update
    pool.totalHoldTimeCredits = _totalHoldTimeCredits(pool);
    pool.updateTime = block.timestamp;
  }

  function _totalHoldTimeCredits(Pool storage pool) internal view returns (uint) {
    // add credits proportional to value held in pool since last update
    return pool.totalHoldTimeCredits + (pool.depositSum * (block.timestamp - pool.updateTime));
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

    // update pool due to passage of time
    Pool storage pool = pools[token];
    _updatePoolHoldTimeCredits(pool);

    // update deposit due to passage of time
    Deposit storage dep = deposits[token][msg.sender];

    // calculate penalty & bunus before making changes
    uint penalty = _depositPenalty(dep);
    // only get bonus if no penalty
    uint bonus = (penalty == 0) ? _depositBonus(pool, dep) : 0;
    uint withdrawShare = dep.value - penalty + bonus;

    // translate to amounts here, before state is updated is zeroed out
    uint withdrawAmount = _shareToAmount(token, withdrawShare);
    uint bonusAmount = _shareToAmount(token, bonus);
    uint penaltyAmount = _shareToAmount(token, penalty);

    // emit event here with all the data
    emit Withdrawed(
      token,
      msg.sender,
      withdrawAmount, 
      dep.value, 
      penaltyAmount, 
      bonusAmount, 
      _depositTimeHeld(dep));

    // update pool state        
    // update total deposits
    pool.depositSum -= dep.value;
    // update bonus
    pool.bonusSum = pool.bonusSum + penalty - bonus;
    // remove the acrued hold time credits for this deposit
    pool.totalHoldTimeCredits -= _holdTimeCredits(dep);
    // remove deposit
    // CAREFUL: note that removing the deposit before this line will 
    // change "dep" because it's used by reference and will ruin the other
    // computations
    delete deposits[token][msg.sender];

    return withdrawAmount;
  }

  function _depositTimeHeld(Deposit storage dep) internal view returns (uint) {
    return block.timestamp - dep.time;
  }

  function _depositPenalty(Deposit storage dep) internal view returns (uint) {
    uint timeHeld = _depositTimeHeld(dep);
    if (timeHeld >= dep.commitPeriod) {
      return 0;
    } else {
      uint timeLeft = dep.commitPeriod - timeHeld;
      // order important to prevent rounding to 0
      return (
        (dep.value * dep.initialPenaltyPercent * timeLeft) 
        / dep.commitPeriod) 
        / 100;
    }
  }

  function _depositBonus(
    Pool storage pool, 
    Deposit storage dep
  ) internal view returns (uint) {
    if (dep.value == 0 || pool.bonusSum == 0) {
      return 0;  // no luck
    } else {
      // V2 calculation: takes into account time held already, instead of
      // snapshot of deposists
      // order important to prevent rounding to 0
      return (pool.bonusSum * _holdTimeCredits(dep)) / _totalHoldTimeCredits(pool);
      // V1 calculation: depends on current deposits only
      // return (pool.bonusSum * dep.value) / pool.depositsSum;
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
