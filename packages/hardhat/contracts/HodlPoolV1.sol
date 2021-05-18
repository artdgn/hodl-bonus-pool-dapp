//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// import "hardhat/console.sol";

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/IERC20.sol
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// https://github.com/Uniswap/uniswap-v2-periphery/blob/master/contracts/interfaces/IWETH.sol
interface IWETH {
  function deposit() external payable;
  function transfer(address to, uint value) external returns (bool);
  function withdraw(uint) external;
}

contract HodlPoolV1 {

  using SafeERC20 for IERC20;

  struct Deposit {
    uint value;
    uint time;
  }
  
  uint public immutable initialPenaltyPercent;  

  uint public immutable commitPeriod;

  address public immutable WETH;

  mapping(address => mapping(address => Deposit)) internal deposits;  

  mapping(address => uint) depositSums;

  mapping(address => uint) bonusSums;

  event Deposited(
    address indexed token, 
    address indexed sender, 
    uint amount, 
    uint time
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

  constructor (uint _initialPenaltyPercent, uint _commitPeriod, address _WETH) {
    require(_initialPenaltyPercent > 0, "no penalty"); 
    require(_initialPenaltyPercent <= 100, "initial penalty > 100%"); 
    // TODO: remove the short commitment check (that's required for testing)
    require(_commitPeriod >= 10 seconds, "commitment period too short");
    // require(_commitPeriod >= 7 days, "commitment period too short");
    require(_commitPeriod <= 365 days, "commitment period too long");
    require(_WETH != address(0), "WETH address can't be 0x0");
    initialPenaltyPercent = _initialPenaltyPercent;
    commitPeriod = _commitPeriod;
    WETH = _WETH;
  }

  receive() external payable {
    require(
      msg.sender == WETH, 
      "no receive() except from WETH contract, use depositETH()");  // testcase transfer from weth
  }

  function deposit(address token, uint amount) external {
    require(amount > 0, "deposit too small");
    deposits[token][msg.sender].value += amount;
    deposits[token][msg.sender].time = block.timestamp;
    depositSums[token] += amount;
    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    emit Deposited(token, msg.sender, amount, block.timestamp);
  }

  function depositETH() external payable {
    require(msg.value > 0, "deposit too small");
    deposits[WETH][msg.sender].value += msg.value;
    deposits[WETH][msg.sender].time = block.timestamp;
    depositSums[WETH] += msg.value;
    IWETH(WETH).deposit{value: msg.value}();
    emit Deposited(WETH, msg.sender, msg.value, block.timestamp);
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
    return deposits[token][sender].value;
  }

  function penaltyOf(address token, address sender) public view returns (uint) {
    return _depositPenalty(deposits[token][sender]);
  }

  function bonusOf(address token, address sender) public view returns (uint) {
    return _depositBonus(
      deposits[token][sender], depositSums[token], bonusSums[token]);
  }

  function depositsSum(address token) public view returns (uint) {
    return depositSums[token];
  }

  function bonusesPool(address token) public view returns (uint) {
    return bonusSums[token];
  }

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
