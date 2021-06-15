//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// import "hardhat/console.sol";

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/IERC20.sol
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/*
 * @title A pool that allows ERC20 deposits and withdrawals with penalty 
 * and bonus mechanisms to encaurage long term holding.
 * @author artdgn (@github)
 * @notice The mechanism rules:
 * - A depositor is committing for the "commitment period", after which the
 *   deposit can be withdrawn with its share of the bonus pool.
 * - Bonus pool is populated from the penalties for early withdrawals,
 *   which are withdrawals done before each deposit's commitment period is elapsed.
 * - The share of the bonus pool is equal to the share of the deposit from all deposits
 *   at the time of withdrawal.
 * - Withdrawal before commitment period is not entitled to any part of the bonus
 *   and is instead "slashed" with a penalty (that is added to the bonus pool).
 * - The penalty percent is decreasing linearly from 
 *   initialPenaltyPercent to 0 with time (for the duration of the commitPeriod). 
 * - Any additional deposit is added to the current deposit and "resets" the
 *   commitment period required to wait.
 * @dev For safety and clarity, the withdrawal functionality is split into 
 * two methods, one for withdrawing with penalty, and the other one for withdrawing
 * with bonus.
 * The total deposits amount is tracked in depositsSum, bonuses in bonusesPool.
 */
contract HodlPoolERC20V0 {

  using SafeERC20 for IERC20;

  struct Deposit {
    uint value;
    uint time;
  }
  
  /// @notice initial maximum percent of penalty
  uint public immutable initialPenaltyPercent;  

  /// @notice time it takes for withdrawal penalty to be reduced to 0
  uint public immutable commitPeriod;

  /// @notice ERC20 token contract this pool is using
  IERC20 public immutable token;

  /// @dev each sender has only a single deposit
  mapping(address => Deposit) internal deposits;  

  /// @notice sum of all deposits currently held in the pool
  uint public depositsSum;

  /// @notice sum of all bonuses currently available for withdrawal
  uint public bonusesPool;

  /*
   * @param sender address that has made the deposit
   * @param amount size of new deposit, or deposit increase
   * @param time timestamp from which the commitment period will be counted
   */
  event Deposited(address indexed sender, uint amount, uint time);

  /*
   * @param sender address that has made the withdrawal
   * @param amount amount sent out to sender as withdrawal
   * @param depositAmount the original amount deposited
   * @param penalty the penalty incurred for this withdrawal
   * @param bonus the bonus included in this withdrawal
   * @param timeHeld the time in seconds the deposit was held
   */
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

  /*
   * @param initialPenaltyPercent_ the penalty percent for early withdrawal penalty 
   *   calculations.
   * @param commitPeriod_ the time in seconds after the deposit at which the 
   *   penalty becomes 0
   * @param token_ the ERC20 token contract address this pool will be using
  */
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

  /// @notice contract doesn't support sending ETH directly, 
  receive() external payable {
    revert("no receive())");
  }

  /// @param amount of token to deposit
  /// @notice any subsequent deposit after the first is added to the first one,
  /// and the time for waiting is "reset".
  function deposit(uint amount) external {
    require(amount > 0, "deposit too small");
    deposits[msg.sender].value += amount;
    deposits[msg.sender].time = block.timestamp;
    depositsSum += amount;
    token.safeTransferFrom(msg.sender, address(this), amount);
    emit Deposited(msg.sender, amount, block.timestamp);
  }

  /// @notice withdraw the full deposit with the proportional share of bonus pool.
  ///   will fail for early withdawals (for which there is another method)
  /// @dev checks that the deposit is non-zero
  function withdrawWithBonus() external onlyDepositors {
    require(
      penaltyOf(msg.sender) == 0, 
      "cannot withdraw without penalty yet, use withdrawWithPenalty()"
    );
    _withdraw();
  }

  /// @notice withdraw the deposit with any applicable penalty. Will withdraw 
  ///   with any available bonus if penalty is 0 (commitment period elapsed).
  /// @dev checks that the deposit is non-zero
  function withdrawWithPenalty() external onlyDepositors {
    _withdraw();
  }

  /// @param sender address of the depositor
  /// @return total deposit of the sender
  function balanceOf(address sender) public view returns (uint) {
    return deposits[sender].value;
  }

  /// @param sender address of the depositor
  /// @return penalty for the sender's deposit if withdrawal would happen now
  function penaltyOf(address sender) public view returns (uint) {
    return _depositPenalty(deposits[sender]);
  }

  /*
   * @param sender address of the depositor
   * @return bonus share of the sender's deposit if withdrawal
   *   would happen now and there was no penalty (the potential bonus).
   * @notice bonus share can be returned with this method before
   *   commitment period is actually done, but it won't be withdrawn 
   *   if the penalty is non-0
  */
  function bonusOf(address sender) public view returns (uint) {
    return _depositBonus(deposits[sender]);
  }

  /// @param sender address of the depositor
  /// @return time in seconds left to wait until sender's deposit can
  /// be withdrawn without penalty
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
