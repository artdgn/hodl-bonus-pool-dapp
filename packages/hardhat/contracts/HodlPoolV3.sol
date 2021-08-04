//SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./extensions/ERC721EnumerableForOwner.sol";
import "./extensions/IWETH.sol";


contract HodlPoolV3 is ERC721EnumerableForOwner {

  using SafeERC20 for IERC20;

  struct Deposit {
    address asset;
    uint40 time;
    uint16 initialPenaltyPercent;
    uint40 commitPeriod;
    uint amount;
  }

  struct Pool {
    uint depositsSum;  
    uint holdBonusesSum;  
    uint commitBonusesSum; 
    uint totalHoldPoints;  
    uint totalHoldPointsUpdateTime;  
    uint totalCommitPoints;  
  }
  
  uint public immutable minInitialPenaltyPercent;  
  uint public immutable minCommitPeriod;
  // slither-disable-next-line naming-convention
  address public immutable WETH;

  uint internal nextTokenId = 1;

  mapping(uint => Deposit) deposits;
  mapping(address => Pool) pools;

  event Deposited(
    address indexed asset, 
    address indexed account, 
    uint amount, 
    uint amountReceived, 
    uint time,
    uint initialPenaltyPercent,
    uint commitPeriod,
    uint tokenId
  );

  event Withdrawed(
    address indexed asset,
    address indexed account, 
    uint amount, 
    uint depositAmount, 
    uint penalty, 
    uint holdBonus,
    uint commitBonus,
    uint timeHeld
  );

  modifier validCommitment(uint initialPenaltyPercent, uint commitPeriod) {
    require(initialPenaltyPercent >= minInitialPenaltyPercent, "penalty too small"); 
    require(initialPenaltyPercent <= 100, "initial penalty > 100%"); 
    require(commitPeriod >= minCommitPeriod, "commitment period too short");
    require(commitPeriod <= 4 * 365 days, "commitment period too long");
    _;
  }

  /*
   * @param _minInitialPenaltyPercent the minimum penalty percent for deposits
   * @param _minCommitPeriod the minimum time in seconds for commitPeriod of a deposit
   * @param _WETH wrapped ETH contract address this pool will be using for ETH
  */
  constructor (
    uint _minInitialPenaltyPercent, 
    uint _minCommitPeriod, 
    address _WETH
  ) 
    ERC721("HodlPool deposit", "Hodl-pool-deposit") 
  {
    require(_minInitialPenaltyPercent > 0, "no min penalty"); 
    require(_minInitialPenaltyPercent <= 100, "minimum initial penalty > 100%"); 
    require(_minCommitPeriod >= 10 seconds, "minimum commitment period too short");
    require(_minCommitPeriod <= 4 * 365 days, "minimum commitment period too long");
    require(_WETH != address(0), "WETH address can't be 0x0");
    minInitialPenaltyPercent = _minInitialPenaltyPercent;
    minCommitPeriod = _minCommitPeriod;
    WETH = _WETH;
  }

  /// @notice contract doesn't support sending ETH directly
  receive() external payable {
    require(
      msg.sender == WETH, 
      "no receive() except from WETH contract, use depositETH()");
  }

  /* * * * * * * * * * *
   * 
   * Public transactions
   * 
   * * * * * * * * * * *
  */

  function deposit(
    address asset, 
    uint amount, 
    uint initialPenaltyPercent,
    uint commitPeriod
  ) external
    validCommitment(initialPenaltyPercent, commitPeriod) 
    returns (uint tokenId)
  {
    require(amount > 0, "empty deposit");

    // interal accounting update
    tokenId = _depositAndMint(
      asset, 
      msg.sender,
      amount,
      initialPenaltyPercent, 
      commitPeriod
    );

    // this contract's balance before the transfer
    uint beforeBalance = IERC20(asset).balanceOf(address(this));

    // transfer
    IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

    // what was actually received, this amount is only used in the event and 
    // not used for any internal accounting so reentrancy from transfer is not
    // a substantial risk
    uint amountReceived = IERC20(asset).balanceOf(address(this)) - beforeBalance;

    // because we want to know how much was received, reentrancy-*events* is low-risk
    // slither-disable-next-line reentrancy-events
    emit Deposited(
      asset,
      msg.sender, 
      amount, 
      amountReceived, 
      block.timestamp, 
      initialPenaltyPercent, 
      commitPeriod,
      tokenId
    );
  }

  function depositETH(
    uint initialPenaltyPercent,
    uint commitPeriod
  ) external
    validCommitment(initialPenaltyPercent, commitPeriod) 
    payable
    returns (uint tokenId)
  {
    require(msg.value > 0, "empty deposit");

    // interal accounting update
    tokenId = _depositAndMint(
      WETH, 
      msg.sender,
      msg.value,
      initialPenaltyPercent, 
      commitPeriod
    );

    emit Deposited(
      WETH, 
      msg.sender, 
      msg.value, 
      msg.value, 
      block.timestamp, 
      initialPenaltyPercent, 
      commitPeriod,
      tokenId
    );

    // note: no share vs. balance accounting for WETH because it's assumed to
    // exactly correspond to actual deposits and withdrawals (no fee-on-transfer etc)
    IWETH(WETH).deposit{value: msg.value}();
  }
  
  function withdrawWithBonus(uint tokenId) external {
    require(
      _timeLeft(deposits[tokenId]) == 0, 
      "cannot withdraw without penalty yet, use withdrawWithPenalty()"
    );
    _withdraw(tokenId);
  }

  /// @notice withdraw ETH with penalty with same logic as withdrawWithPenalty()
  function withdrawWithBonusETH(uint tokenId) external {
    require(
      _timeLeft(deposits[tokenId]) == 0, 
      "cannot withdraw without penalty yet, use withdrawWithPenaltyETH()"
    );
    _withdrawETH(tokenId);
  }

  function withdrawWithPenalty(uint tokenId) external {
    _withdraw(tokenId);
  }

  /// @notice withdraw ETH with penalty with same logic as withdrawWithPenalty()
  function withdrawWithPenaltyETH(uint tokenId) external {
    _withdrawETH(tokenId);
  }

  /* * * * * * * *
   * 
   * Public views
   * 
   * * * * * * * *
  */

  function depositDetails(
    uint tokenId
  ) external view returns (uint[12] memory) {
    address account = ownerOf(tokenId);
    Deposit storage dep = deposits[tokenId];
    return [
      uint(uint160(dep.asset)),  // asset
      uint(uint160(account)),  // account owner
      _sharesToAmount(dep.asset, dep.amount),  // balance
      _timeLeft(dep),  // timeLeftToHold
      _sharesToAmount(dep.asset, _depositPenalty(dep)),  // penalty
      _sharesToAmount(dep.asset, _holdBonus(dep)),  // holdBonus
      _sharesToAmount(dep.asset, _commitBonus(dep)),  // commitBonus
      _holdPoints(dep),  // holdPoints
      _commitPoints(dep),  // commitPoints
      dep.initialPenaltyPercent,  // initialPenaltyPercent
      _currentPenaltyPercent(dep),  // currentPenaltyPercent
      dep.commitPeriod  // commitPeriod
    ];
  }

  function poolDetails(address asset) external view returns (uint[5] memory) {
    Pool storage pool = pools[asset];
    return [
      _sharesToAmount(asset, pool.depositsSum),  // depositsSum
      _sharesToAmount(asset, pool.holdBonusesSum),  // holdBonusesSum
      _sharesToAmount(asset, pool.commitBonusesSum),  // commitBonusesSum
      _totalHoldPoints(pool),  // totalHoldPoints
      pool.totalCommitPoints  // totalCommitPoints
    ];
  }

  function depositsOfOwner(
    address account
  ) external view returns (
      uint[] memory tokenIds, 
      Deposit[] memory accountDeposits
  ) {
    uint balance = balanceOf(account);
    tokenIds = new uint[](balance);
    accountDeposits = new Deposit[](balance);
    for (uint i; i < balance; i++) {
      tokenIds[i] = tokenOfOwnerByIndex(account, i);
      accountDeposits[i] = deposits[tokenIds[i]];
    }
  }

  /* * * * * * * * * * * *
   * 
   * Internal transactions
   * 
   * * * * * * * * * * * *
  */

  /// @dev the order of calculations is important for correct accounting
  function _depositAndMint(
    address asset, 
    address account,
    uint amount, 
    uint initialPenaltyPercent, 
    uint commitPeriod
  ) internal returns (uint tokenId) {
    // get token id and increment
    tokenId = nextTokenId++;

    // mint token
    _mint(account, tokenId);

    // add deposit data
    deposits[tokenId] = Deposit({
      asset: asset,
      time: uint40(block.timestamp),
      initialPenaltyPercent: uint16(initialPenaltyPercent),
      commitPeriod: uint40(commitPeriod),
      amount: amount
    });

    // pool state update
    _addDepositToPool(asset, deposits[tokenId]);
  }

  function _addDepositToPool(address asset, Deposit storage dep) internal {
    Pool storage pool = pools[asset];
    // update pool's total hold time due to passage of time
    // because the deposits sum is going to change
    _updatePoolHoldPoints(pool);
    // WARNING: the deposits sum needs to be updated after the hold-points
    // for the passed time were updated
    pool.depositsSum += dep.amount;    
    pool.totalCommitPoints += _commitPoints(dep);
  }

  // this happens on every pool interaction (so every withdrawal and deposit to that pool)
  function _updatePoolHoldPoints(Pool storage pool) internal {
    // add points proportional to amount held in pool since last update
    pool.totalHoldPoints = _totalHoldPoints(pool);    
    pool.totalHoldPointsUpdateTime = block.timestamp;
  }  
  
  function _withdraw(uint tokenId) internal {
    address asset = deposits[tokenId].asset;
    address account = ownerOf(tokenId);
    require(account == msg.sender, "not deposit owner");
    uint amountOut = _amountOutAndBurn(tokenId);
    // WARNING: asset and account must be set before token is burned
    IERC20(asset).safeTransfer(account, amountOut);
  }

  function _withdrawETH(uint tokenId) internal {
    address account = ownerOf(tokenId);
    require(account == msg.sender, "not deposit owner");
    require(deposits[tokenId].asset == WETH, "not an ETH / WETH deposit");
    
    uint amountOut = _amountOutAndBurn(tokenId);

    IWETH(WETH).withdraw(amountOut);
    // WARNING: account must be set before token is burned
    // - call is used because if contract is withdrawing it may need more gas than what .transfer sends
    // slither-disable-next-line low-level-calls
    (bool success, ) = payable(account).call{value: amountOut}("");
    require(success);
  }

  /// @dev the order of calculations is important for correct accounting
  function _amountOutAndBurn(uint tokenId) internal returns (uint amountOut) {
    // WARNING: deposit is only read here and is not updated until it's removal
    Deposit storage dep = deposits[tokenId];
    address asset = dep.asset;

    Pool storage pool = pools[asset];
    // update pool hold-time points due to passage of time
    // WARNING: failing to do so will break hold-time holdBonus calculation
    _updatePoolHoldPoints(pool);

    // calculate penalty & bunus before making changes
    uint penalty = _depositPenalty(dep);
    uint holdBonus = 0;
    uint commitBonus = 0;
    uint withdrawShare = dep.amount - penalty;
    if (penalty == 0) {
      // only get any bonuses if no penalty
      holdBonus =  _holdBonus(dep);
      commitBonus =  _commitBonus(dep);
      withdrawShare += holdBonus + commitBonus;
    }
    
    // WARNING: get amount here before state is updated
    amountOut = _sharesToAmount(asset, withdrawShare);

    // WARNING: emit event here with all the needed data, before pool state updates
    // affect shareToAmount calculations    
    emit Withdrawed(
      asset,
      ownerOf(tokenId),
      amountOut, 
      dep.amount, 
      _sharesToAmount(asset, penalty), 
      _sharesToAmount(asset, holdBonus), 
      _sharesToAmount(asset, commitBonus), 
      _timeHeld(dep.time)
    );

    // pool state update
    // WARNING: shares calculations need to happen before this update
    // because the depositSum changes    
    _removeDepositFromPool(pool, dep, penalty, holdBonus, commitBonus);
    
    // deposit update: remove deposit
    // WARNING: note that removing the deposit before this line will 
    // change "dep" because it's used by reference and will affect the other
    // computations for pool state updates (e.g. hold points)    
    delete deposits[tokenId];   

    // burn token
    _burn(tokenId);
  }

  function _removeDepositFromPool(
    Pool storage pool, Deposit storage dep, uint penalty, uint holdBonus, uint commitBonus
  ) internal {
    // update total deposits
    pool.depositsSum -= dep.amount;        
    // remove the acrued hold-points for this deposit
    pool.totalHoldPoints -= _holdPoints(dep);
    // remove the commit-points
    pool.totalCommitPoints -= _commitPoints(dep);
        
    if (penalty == 0 && (holdBonus > 0 || commitBonus > 0)) {
      pool.holdBonusesSum -= holdBonus;
      // update commitBonus pool
      pool.commitBonusesSum -= commitBonus;  
    } else {
      // update hold-bonus pool: split the penalty into two parts
      // half for hold bonuses, half for commit bonuses
      pool.holdBonusesSum += penalty / 2;
      // update commitBonus pool
      pool.commitBonusesSum += (penalty - (penalty / 2));
    }
  }

  /* * * * * * * * *
   * 
   * Internal views
   * 
   * * * * * * * * *
  */

  function _timeHeld(uint time) internal view returns (uint) {
    return block.timestamp - time;
  }

  function _timeLeft(Deposit storage dep) internal view returns (uint) {
    uint timeHeld = _timeHeld(dep.time);
    return (timeHeld >= dep.commitPeriod) ? 0 : (dep.commitPeriod - timeHeld);
  }

  function _holdPoints(Deposit storage dep) internal view returns (uint) {
    // points proportional to amount held since deposit start    
    return dep.amount * _timeHeld(dep.time);
  }

  function _commitPoints(Deposit storage dep) internal view returns (uint) {
    // points proportional to amount held since deposit start    
    // triangle area of commitpent time and penalty
    return (
      dep.amount * dep.initialPenaltyPercent * dep.commitPeriod
      / 100 / 2
    );
  }

  function _currentPenaltyPercent(Deposit storage dep) internal view returns (uint) {
    uint timeLeft = _timeLeft(dep);
    if (timeLeft == 0) { // no penalty
      return 0;
    } else {
      // current penalty percent is proportional to time left
      uint curPercent = (dep.initialPenaltyPercent * timeLeft) / dep.commitPeriod;
      // add 1 to compensate for rounding down unless when below initial amount
      return curPercent < dep.initialPenaltyPercent ? curPercent + 1 : curPercent;
    }
  }

  function _depositPenalty(Deposit storage dep) internal view returns (uint) {
    uint timeLeft = _timeLeft(dep);
    if (timeLeft == 0) {  // no penalty
      return 0;
    } else {
      // order important to prevent rounding to 0
      return (
        (dep.amount * dep.initialPenaltyPercent * timeLeft) 
        / dep.commitPeriod)  // can't be zero
        / 100;
    }
  }

  function _holdBonus(Deposit storage dep) internal view returns (uint) {
    Pool storage pool = pools[dep.asset];
    // share of bonus is proportional to hold-points of this deposit relative
    // to total hold-points in the pool
    // order important to prevent rounding to 0
    uint denom = _totalHoldPoints(pool);  // don't divide by 0
    uint holdPoints = _holdPoints(dep);
    return denom > 0 ? ((pool.holdBonusesSum * holdPoints) / denom) : 0;
  }

  function _commitBonus(Deposit storage dep) internal view returns (uint) {
    Pool storage pool = pools[dep.asset];
    // share of bonus is proportional to commit-points of this deposit relative
    // to all other commit-points in the pool
    // order important to prevent rounding to 0
    uint denom = pool.totalCommitPoints;  // don't divide by 0
    uint commitPoints = _commitPoints(dep);
    return denom > 0 ? ((pool.commitBonusesSum * commitPoints) / denom) : 0;
  }

  function _totalHoldPoints(Pool storage pool) internal view returns (uint) {
    uint elapsed = block.timestamp - pool.totalHoldPointsUpdateTime;
    // points proportional to amount held in pool since last update
    return pool.totalHoldPoints + (pool.depositsSum * elapsed);
  }

  /// @dev translates deposit shares to actual token amounts - which can be different 
  /// from the initial deposit amount for tokens with funky fees and supply mechanisms.
  function _sharesToAmount(address asset, uint share) internal view returns (uint) {
    if (share == 0) {  // gas savings
      return 0;
    }
    // all tokens that belong to this contract are either 
    // in deposits or in the two bonuses pools
    Pool storage pool = pools[asset];
    uint totalShares = pool.depositsSum + pool.holdBonusesSum + pool.commitBonusesSum;
    if (totalShares == 0) {  // don't divide by zero
      return 0;  
    } else {
      // it's safe to call external balanceOf here because 
      // it's a view (and this method is also view)
      uint actualBalance = IERC20(asset).balanceOf(address(this));      
      return actualBalance * share / totalShares;
    }
  }  
    
}
