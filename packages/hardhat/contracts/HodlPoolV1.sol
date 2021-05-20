//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// import "hardhat/console.sol";

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/IERC20.sol
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev interface for interacting with WETH (wrapped ether) for handling ETH
///   https://github.com/Uniswap/uniswap-v2-periphery/blob/master/contracts/interfaces/IWETH.sol
interface IWETH {
  function deposit() external payable;
  function transfer(address to, uint value) external returns (bool);
  function withdraw(uint) external;
}

/*
 * @title Token pools that allows different ERC20 tokens and ETH deposits and withdrawals
 * with penalty and bonus mechanisms to encaurage long term holding. 
 * Each token has one independent pool. i.e. all accounting is separate for each token.
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
 * Also, the ERC20 token and ETH functionality is split into separate methods.
 * The total deposits amount is tracked per token contract in 
 * depositSums, bonuses in bonusSums.
 */
contract HodlPoolV1 {

  using SafeERC20 for IERC20;

  struct Deposit {
    uint value;
    uint time;
  }
  
  /// @notice initial maximum percent of penalty
  uint public immutable initialPenaltyPercent;  

  /// @notice time it takes for withdrawal penalty to be reduced to 0
  uint public immutable commitPeriod;

  /// @notice WETH token contract this pool is using for handling ETH
  address public immutable WETH;

  /// @dev token deposits per token contract and per user
  /// each sender has only a single deposit 
  mapping(address => mapping(address => Deposit)) internal deposits;  

  /// @dev sum of all deposits currently held in the pool for each token contract
  mapping(address => uint) depositSums;

  /// @dev sum of all bonuses currently available for withdrawal 
  /// for each token contract
  mapping(address => uint) bonusSums;

  /*
   * @param token ERC20 token address for the deposited token
   * @param sender address that has made the deposit
   * @param amount size of new deposit, or deposit increase
   * @param time timestamp from which the commitment period will be counted
   */
  event Deposited(
    address indexed token, 
    address indexed sender, 
    uint amount, 
    uint time
  );

  /*
   * @param token ERC20 token address for the withdrawed token
   * @param sender address that has made the withdrawal
   * @param amount amount sent out to sender as withdrawal
   * @param depositAmount the original amount deposited
   * @param penalty the penalty incurred for this withdrawal
   * @param bonus the bonus included in this withdrawal
   * @param timeHeld the time in seconds the deposit was held
   */
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

  /*
   * @param _initialPenaltyPercent the penalty percent for early withdrawal penalty 
   *   calculations.
   * @param _commitPeriod the time in seconds after the deposit at which the 
   *   penalty becomes 0
   * @param _WETH wrapped ETH contract address this pool will be using for ETH
  */
  constructor (uint _initialPenaltyPercent, uint _commitPeriod, address _WETH) {
    require(_initialPenaltyPercent > 0, "no penalty"); 
    require(_initialPenaltyPercent <= 100, "initial penalty > 100%"); 
    require(_commitPeriod >= 60 seconds, "commitment period too short");
    require(_commitPeriod <= 365 days, "commitment period too long");
    require(_WETH != address(0), "WETH address can't be 0x0");
    initialPenaltyPercent = _initialPenaltyPercent;
    commitPeriod = _commitPeriod;
    WETH = _WETH;
  }

  /// @notice contract doesn't support sending ETH directly
  receive() external payable {
    require(
      msg.sender == WETH, 
      "no receive() except from WETH contract, use depositETH()");
  }

  /*
   * @param token address of token contract
   * @param amount of token to deposit
   * @notice any subsequent deposit after the first is added to the first one,
   * and the time for waiting is "reset".
   */
  function deposit(address token, uint amount) external {
    require(amount > 0, "deposit too small");
    deposits[token][msg.sender].value += amount;
    deposits[token][msg.sender].time = block.timestamp;
    depositSums[token] += amount;
    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    emit Deposited(token, msg.sender, amount, block.timestamp);
  }

  /// @notice payable method for depositing ETH with same logic as deposit()
  function depositETH() external payable {
    require(msg.value > 0, "deposit too small");
    deposits[WETH][msg.sender].value += msg.value;
    deposits[WETH][msg.sender].time = block.timestamp;
    depositSums[WETH] += msg.value;
    IWETH(WETH).deposit{value: msg.value}();
    emit Deposited(WETH, msg.sender, msg.value, block.timestamp);
  }

  /*
   * @param token address of token contract
   * @notice withdraw the full deposit with the proportional share of bonus pool.
   * will fail for early withdawals (for which there is another method)
   * @dev checks that the deposit is non-zero
   */
  function withdrawWithBonus(address token) external onlyDepositors(token) {
    require(
      penaltyOf(token, msg.sender) == 0, 
      "cannot withdraw without penalty yet, use withdrawWithPenalty()"
    );
    _withdraw(token);
  }

  /// @notice withdraw ETH with bonus with same logic as withdrawWithBonus()
  function withdrawWithBonusETH() external onlyDepositors(WETH) {
    require(
      penaltyOf(WETH, msg.sender) == 0, 
      "cannot withdraw without penalty yet, use withdrawWithPenalty()"
    );
    _withdrawETH();
  }

  /*
   * @param token address of token contract
   * @notice withdraw the deposit with any applicable penalty. Will withdraw 
   * with any available bonus if penalty is 0 (commitment period elapsed).
   * @dev checks that the deposit is non-zero
   */
  function withdrawWithPenalty(address token) external onlyDepositors(token) {
    _withdraw(token);
  }

  /// @notice withdraw ETH with penalty with same logic as withdrawWithPenalty()
  function withdrawWithPenaltyETH() external onlyDepositors(WETH) {
    _withdrawETH();
  }

  /// @param token address of token contract
  /// @param sender address of the depositor
  /// @return total deposit of the sender
  function balanceOf(address token, address sender) public view returns (uint) {
    return deposits[token][sender].value;
  }

  /// @param token address of token contract
  /// @param sender address of the depositor
  /// @return penalty for the sender's deposit if withdrawal would happen now
  function penaltyOf(address token, address sender) public view returns (uint) {
    return _depositPenalty(deposits[token][sender]);
  }

  /*
   * @param token address of token contract
   * @param sender address of the depositor
   * @return bonus share of the sender's deposit if withdrawal
   *   would happen now and there was no penalty (the potential bonus).
   * @notice bonus share can be returned with this method before
   *   commitment period is actually done, but it won't be withdrawn 
   *   if the penalty is non-0
  */
  function bonusOf(address token, address sender) public view returns (uint) {
    return _depositBonus(
      deposits[token][sender], depositSums[token], bonusSums[token]);
  }

  /// @param token address of token contract
  /// @return sum of all current deposits of the token
  function depositsSum(address token) public view returns (uint) {
    return depositSums[token];
  }

  /// @param token address of token contract
  /// @return size the current bonus pool for the token
  function bonusesPool(address token) public view returns (uint) {
    return bonusSums[token];
  }

  /// @param token address of token contract
  /// @param sender address of the depositor
  /// @return time in seconds left to wait until sender's deposit can
  function timeLeftToHoldOf(
    address token, 
    address sender
  ) public view returns (uint) {
    if (balanceOf(token, sender) == 0) return 0;
    uint timeHeld = _depositTimeHeld(deposits[token][sender]);
    return (timeHeld < commitPeriod) ? (commitPeriod - timeHeld) : 0;
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
  
  /// @dev emits the Withdrawed event
  function _withdrawAmountAndUpdate(address token) internal returns (uint) {
    Deposit memory dep = deposits[token][msg.sender];

    // calculate penalty & bunus before making changes
    uint penalty = _depositPenalty(dep);
    // only get bonus if no penalty
    uint bonus = (penalty == 0) ? 
      _depositBonus(dep, depositSums[token], bonusSums[token]) : 0;
    uint withdrawAmount = dep.value - penalty + bonus;

    // update state
    // remove deposit
    deposits[token][msg.sender] = Deposit(0, 0);
    // update total deposits
    depositSums[token] -= dep.value;
    // update bonus
    bonusSums[token] = bonusSums[token] + penalty - bonus;
    
    // emit event here with all the data
    emit Withdrawed(
      token,
      msg.sender,
      withdrawAmount, 
      dep.value, 
      penalty, 
      bonus, 
      _depositTimeHeld(dep));
    
    return withdrawAmount;
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

  function _depositBonus(
    Deposit memory dep, 
    uint depositsSum_,
    uint bonusSum_
  ) internal pure returns (uint) {
    if (dep.value == 0 || bonusSum_ == 0) {
      return 0;  // no luck
    } else {
      // order important to prevent rounding to 0
      return (bonusSum_ * dep.value) / depositsSum_;
    }
  }

}
