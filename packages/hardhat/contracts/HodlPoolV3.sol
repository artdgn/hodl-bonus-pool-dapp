//SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./extensions/ERC721EnumerableForOwner.sol";
import "./extensions/IWETH.sol";

/*
 * @title Token pools that allow different ERC20 tokens (assets) and ETH deposits 
 * and withdrawals with penalty and bonus mechanisms that incentivise long term holding. 
 * The initial penalty and commitment time are chosen at the time of the deposit by
 * the user.
 * The deposits into this contract are transferrable and immutable ERC721 tokens.
 * There are two bonus types for each pool - holding bonus (to incetivise holding), 
 * and commitment bonus (to incetivise commiting to penalties & time).
 * Each ERC20 asset has one independent pool. i.e. all accounting is separate.
 * ERC20 tokens may have fee-on-transfer or dynamic supply mechanisms, and for these
 * kinds of tokens this contract tracks everything as "shares of initial deposits". 
 * @notice The mechanism rules:
 * - A depositor is committing for "commitment period" and an "initial penalty percent" 
 *   of his choice (within allowed ranges). After the commitment period the
 *   deposit can be withdrawn with its share of both of the bonus pools.
 * - The two bonus pools are populated from the penalties for early withdrawals,
 *   which are withdrawals done before a deposit's commitment period is elapsed.
 * - The penalties are split in half and added to both bonus pools (isolated per asset): 
 *   Hold bonus pool and Commit bonus pool.
 * - The share of the bonus pools is equal to the share of the bonus points (hold-points 
 *   and commit-points) for the deposit at the time of withdrawal relative to the other
 *   deposits in the pool.
 * - Hold points are calculated as amount of asset x seconds held. So more tokens
 *   held for longer add more points - and increase the bonus share. This bonus is
 *   independent of commitment or penalties. The points keep increasing after commitment period
 *   is over.
 * - Commit points are calculated as amount of asset x seconds committed to penalty.
 *   These points depend only on commitment time and commitment penalty 
 *   at the time of the deposit.
 * - Withdrawal before commitment period is not entitled to any part of the bonus
 *   and is instead "slashed" with a penalty (that is split between the bonuses pools).
 * - The penalty percent is decreasing with time from the chosen
 *   initialPenaltyPercent to 0 at the end of the commitPeriod. 
 * - Each deposit has a separate ERC721 tokenId with the usual tranfer mechanics. So
 *   multiple deposits for same owner and asset but with different commitment
 *   parameters can co-exist independently.
 * - Deposits can be deposited for another account as beneficiary,
 *   so e.g. a team / DAO can deposit its tokens for its members to withdraw.
 * - Only the deposit "owner" can use the withdrawal functionality, so ERC721 approvals 
 *   allow transfers, but not the withdrawals.
 *
 * @dev 
 * 1. For safety and clarity, the withdrawal functionality is split into 
 * two methods, one for withdrawing with penalty, and the other one for withdrawing
 * with bonus.
 * 2. The ERC20 token and ETH functionality is split into separate methods.
 * The total deposits shares are tracked per token contract in 
 * depositSums, bonuses in bonusSums.
 * 3. Deposit for self depositFor are split into separate methods
 * for clarity.
 * 4. For tokens with dynamic supply mechanisms and fee on transfer all internal
 * calculations are done using the "initial desposit amounts" as fair shares, and
 * upon withdrawal are translated to actual amounts of the contract's token balance.
 * This means that for these tokens the actual amounts received are depends on their
 * mechanisms (because the amount is unknown before actual transfers).
 * 5. To reduce RPC calls and simplify interface, all the deposit and pool views are
 * batched in depositDetails and poolDetails which return arrays of values.
 * 6. To prevent relying on tracking deposit, withdrawal, and transfer events
 * depositsOfOwner view shows all deposits owned by a particular owner.
 * 7. The total of a pool's hold points are updated incrementally on each interaction
 * with a pool using the depositsSum in that pool for that period. If can only happen
 * once per block because it depends on the time since last update.
 * 8. TokenURI returns a JSON string with just name and description metadata.
 *
 * @author artdgn (@github)
 */
contract HodlPoolV3 is ERC721EnumerableForOwner {

  using SafeERC20 for IERC20;
  using Strings for uint;

  /// @dev state variables for a deposit in a pool
  struct Deposit {
    address asset;
    uint40 time;
    uint16 initialPenaltyPercent;
    uint40 commitPeriod;
    uint amount;
  }

  /// @dev state variables for a token pool
  struct Pool {
    uint depositsSum;  // sum of all current deposits
    uint holdBonusesSum;  // sum of hold bonus pool
    uint commitBonusesSum;  // sum of commit bonus pool
    uint totalHoldPoints;  // sum of hold-points 
    uint totalHoldPointsUpdateTime;  //  time of the latest hold-points update
    uint totalCommitPoints;  // sum of commit-points
  }
  
  /// @notice minimum initial percent of penalty
  uint public immutable minInitialPenaltyPercent;  

  /// @notice minimum commitment period for a deposit
  uint public immutable minCommitPeriod;

  /// @notice compatibility with ERC20 for e.g. viewing in metamask
  uint public constant decimals = 0;

  /// @notice WETH token contract this pool is using for handling ETH
  // slither-disable-next-line naming-convention
  address public immutable WETH;

  /// @dev tokenId incremted counter
  uint internal nextTokenId = 1;

  /// @dev deposit data for each tokenId
  mapping(uint => Deposit) deposits;

  /// @dev pool state for each token contract address
  mapping(address => Pool) pools;

  /*
   * @param asset ERC20 token address for the deposited asset
   * @param account address that has made the deposit
   * @param amount size of new deposit, or deposit increase
   * @param amountReceived received balance after transfer (actual deposit)
   *  which may be different due to transfer-fees and other token shenanigans
   * @param time timestamp from which the commitment period will be counted
   * @param initialPenaltyPercent initial penalty percent for the deposit
   * @param commitPeriod commitment period in seconds for the deposit
   * @param tokenId deposit ERC721 tokenId
   */
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

  /*
   * @param asset ERC20 token address for the withdrawed asset
   * @param account address that has made the withdrawal
   * @param amount amount sent out to account as withdrawal
   * @param depositAmount the original amount deposited
   * @param penalty the penalty incurred for this withdrawal
   * @param holdBonus the hold-bonus included in this withdrawal
   * @param commitBonus the commit-bonus included in this withdrawal
   * @param timeHeld the time in seconds the deposit was held
   */
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

  /// @dev checks commitment params are within allowed ranges
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
    ERC721("HodlBonusPool V3", "HodlPoolV3") 
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

  /*
   * @notice adds a deposit into its asset pool and mints an ERC721 token
   * @param asset address of ERC20 token contract
   * @param amount of token to deposit
   * @param initialPenaltyPercent initial penalty percent for deposit
   * @param commitPeriod period during which a withdrawal results in penalty and no bonus
   * @return ERC721 tokenId of this deposit   
   */
  function deposit(
    address asset, 
    uint amount, 
    uint initialPenaltyPercent,
    uint commitPeriod
  ) public
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

  /*
   * @notice payable method for depositing ETH with same logic as deposit(), 
   * adds a deposit into WETH asset pool and mints an ERC721 token
   * @param initialPenaltyPercent initial penalty percent for deposit
   * @param commitPeriod period during which a withdrawal results in penalty and no bonus
   * @return ERC721 tokenId of this deposit
   */
  function depositETH(
    uint initialPenaltyPercent,
    uint commitPeriod
  ) public
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

  /*
   * @notice adds a deposit, mints an ERC721 token, and transfers
   * its ownership to another account
   * @param account that will be the owner of this deposit (can withdraw)
   * @param asset address of ERC20 token contract
   * @param amount of token to deposit
   * @param initialPenaltyPercent initial penalty percent for deposit
   * @param commitPeriod period during which a withdrawal results in penalty and no bonus
   * @return ERC721 tokenId of this deposit   
   */
  function depositFor(
    address account,
    address asset, 
    uint amount, 
    uint initialPenaltyPercent,
    uint commitPeriod
  ) external
    validCommitment(initialPenaltyPercent, commitPeriod) 
    returns (uint tokenId) {
    tokenId = deposit(asset, amount, initialPenaltyPercent, commitPeriod);
    _transfer(msg.sender, account, tokenId);
  }

  /*
   * @notice adds an ETH deposit, mints an ERC721 token, and transfers
   * its ownership to another account
   * @param account that will be the owner of this deposit (can withdraw)
   * @param initialPenaltyPercent initial penalty percent for deposit
   * @param commitPeriod period during which a withdrawal results in penalty and no bonus
   * @return ERC721 tokenId of this deposit
   */
  function depositETHFor(
    address account,
    uint initialPenaltyPercent,
    uint commitPeriod
  ) external payable
    validCommitment(initialPenaltyPercent, commitPeriod) 
    returns (uint tokenId) {
    tokenId = depositETH(initialPenaltyPercent, commitPeriod);
    _transfer(msg.sender, account, tokenId);
  }
  
  /*
   * @param tokenId ERC721 tokenId of the deposit to withdraw
   * @notice withdraw the full deposit with the proportional shares of bonus pools.
   *   will fail for early withdawals (for which there is another method)
   * @dev checks that the deposit is non-zero
   */
  function withdrawWithBonus(uint tokenId) external {
    require(
      _timeLeft(deposits[tokenId]) == 0, 
      "cannot withdraw without penalty yet, use withdrawWithPenalty()"
    );
    _withdrawERC20(tokenId);
  }

  /// @notice withdraw ETH with bonus with same logic as withdrawWithBonus()
  function withdrawWithBonusETH(uint tokenId) external {
    require(
      _timeLeft(deposits[tokenId]) == 0, 
      "cannot withdraw without penalty yet, use withdrawWithPenaltyETH()"
    );
    _withdrawETH(tokenId);
  }

  /*
   * @param tokenId ERC721 tokenId of the deposit to withdraw
   * @notice withdraw the deposit with any applicable penalty. Will withdraw 
   * with any available bonus if penalty is 0 (commitment period elapsed).
   */
  function withdrawWithPenalty(uint tokenId) external {
    _withdrawERC20(tokenId);
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

  /*
   * @param tokenId ERC721 tokenId of a deposit
   * @return array of 12 values corresponding to the details of the deposit:
   *  0. asset - asset address converted to uint
   *  1. owner - deposit owner
   *  2. balance - original deposit(s) value
   *  3. timeLeftToHold - time in seconds until deposit can be withdrawed 
   *     with bonus and no penalty
   *  4. penalty - penalty if withdrawed now
   *  5. holdBonus - hold-bonus if withdrawed now (if possible to withdraw with bonus)
   *  6. commitBonus - commit-bonus if withdrawed now (if possible to withdraw with bonus)
   *  7. holdPoints - current amount of hold-point
   *  8. commitPoints - current amount of commit-point
   *  9. initialPenaltyPercent - initial penalty percent (set at time od deposit)
   *  10. currentPenaltyPercent - current penalty percent (penalty percent if withdrawed now)
   *  11. commitPeriod - commitment period set at the time of deposit
   */
  function depositDetails(
    uint tokenId
  ) external view returns (uint[12] memory) {
    Deposit storage dep = deposits[tokenId];
    Pool storage pool = pools[dep.asset];
    address owner = _exists(tokenId) ? ownerOf(tokenId) : address(0);
    return [
      uint(uint160(dep.asset)),  // asset
      uint(uint160(owner)),  // account owner
      _sharesToAmount(dep.asset, dep.amount),  // balance
      _timeLeft(dep),  // timeLeftToHold
      _sharesToAmount(dep.asset, _depositPenalty(dep)),  // penalty
      _sharesToAmount(dep.asset, _holdBonus(pool, dep)),  // holdBonus
      _sharesToAmount(dep.asset, _commitBonus(pool, dep)),  // commitBonus
      _holdPoints(dep),  // holdPoints
      _commitPoints(dep),  // commitPoints
      dep.initialPenaltyPercent,  // initialPenaltyPercent
      _currentPenaltyPercent(dep),  // currentPenaltyPercent
      dep.commitPeriod  // commitPeriod
    ];
  }

  /*
   * @param asset address of ERC20 token contract
   * @return array of 5 values corresponding to the details of the pool:
   *  0. depositsSum - sum of current deposits
   *  1. holdBonusesSum - sum of tokens to be distributed as hold bonuses
   *  2. commitBonusesSum - sum of tokens to be distributed as commitment bonuses
   *  3. totalHoldPoints - sum of hold-points of all current deposits
   *  4. totalCommitPoints - sum of commit-points of all current deposits
   */
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

  /*
   * @param account address of an owner account
   * @return two arrays of the deposits owned by this account:
   *  0. array of deposits' tokenIds
   *  1. array of deposits' data (Deposit struct)
   */
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

  /*
   * @param tokenId ERC721 tokenId of a deposit
   * @return string with metadata JSON containing the NFT's name and description
   */
  function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
      require(_exists(tokenId), "ERC721: nonexistent token");
      Deposit storage dep = deposits[tokenId];
      return string(abi.encodePacked(
        '{"name":"Hodl-bonus-pool deposit, tokenId: ', 
        tokenId.toString(),
        '", "description":"ERC20 asset address: ',
        (uint(uint160(dep.asset))).toHexString(20),
        '\\nDeposited amount: ',
        dep.amount.toString(),
        ' wei (of token)\\nDeposited at: ',
        uint(dep.time).toString(),
        ' seconds unix epoch\\nInitial penalty percent: ',
        uint(dep.initialPenaltyPercent).toString(),
        '%\\nCommitment period: ',
        uint(dep.commitPeriod).toString(),
        ' seconds"}'
      ));
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

  /// @dev pool state update for new deposit
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
  
  function _withdrawERC20(uint tokenId) internal {
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
      holdBonus =  _holdBonus(pool, dep);
      commitBonus =  _commitBonus(pool, dep);
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

  /// @dev pool state update for removing a deposit
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

  function _holdBonus(Pool storage pool, Deposit storage dep) internal view returns (uint) {
    // share of bonus is proportional to hold-points of this deposit relative
    // to total hold-points in the pool
    // order important to prevent rounding to 0
    uint denom = _totalHoldPoints(pool);  // don't divide by 0
    uint holdPoints = _holdPoints(dep);
    return denom > 0 ? ((pool.holdBonusesSum * holdPoints) / denom) : 0;
  }

  function _commitBonus(Pool storage pool, Deposit storage dep) internal view returns (uint) {
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

  // remove super implementation
  function _baseURI() internal view virtual override returns (string memory) {}  
      
}
