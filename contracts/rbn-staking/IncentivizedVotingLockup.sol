// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {IIncentivisedVotingLockup} from "../interfaces/IIncentivisedVotingLockup.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Detailed} from "../interfaces/IERC20Detailed.sol";
import {ISmartWalletChecker} from "../interfaces/ISmartWalletChecker.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {StableMath} from "../libraries/StableMath.sol";
import {Root} from "../libraries/Root.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title  IncentivisedVotingLockup
 * @author Voting Weight tracking & Decay
 *             -> Curve Finance (MIT) - forked & ported to Solidity
 *             -> https://github.com/curvefi/curve-dao-contracts/blob/master/contracts/VotingEscrow.vy
 * @notice Lockup RBN, receive sRBN (voting weight that decays over time), and earn
 *         RBN
 * @dev    Supports:
 *            1) Tracking MTA Locked up (LockedBalance)
 *            2) Decaying voting weight lookup through CheckpointedERC20 (balanceOf)
 *            3) Delegation
 */
contract IncentivisedVotingLockup is
  IIncentivisedVotingLockup,
  Ownable,
  ReentrancyGuard
{
  using StableMath for uint256;
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  /** Shared Events */
  event Deposit(
    address indexed provider,
    uint256 value,
    uint256 locktime,
    LockAction indexed action,
    uint256 ts
  );
  event Withdraw(address indexed provider, uint256 value, uint256 ts);
  event ContractStopped(bool contractStopped);
  // An event thats emitted when an account changes its delegate
  event DelegateSet(
    address indexed delegator,
    address indexed toDelegate,
    uint96 amount,
    uint96 expireTime
  );
  // An event thats emitted when an account removes its delegate
  event DelegateRemoved(
    address indexed delegator,
    address indexed delegateeToRemove,
    uint256 amtDelegationRemoved
  );

  event CommitSmartWalletChecker(address indexed checker);
  event ApplySmartWalletChecker(address indexed checker);

  // RBN Redeemer contract
  address public rbnRedeemer;

  // Checker for whitelisted (smart contract) wallets which are allowed to deposit
  // The goal is to prevent tokenizing the escrow
  address public futureSmartWalletChecker;
  address public smartWalletChecker;

  /** Shared Globals */
  IERC20 public stakingToken;
  uint256 private constant WEEK = 7 days;
  uint256 public constant MAXTIME = 4 * 365 days; // 4 years
  uint256 public END = block.timestamp + MAXTIME;

  /** Lockup */
  uint256 public globalEpoch;
  uint256 public totalShares;
  uint256 public totalLocked;
  Point[] public pointHistory;
  bool public contractStopped;
  mapping(address => Point[]) public userPointHistory;
  mapping(address => uint256) public userPointEpoch;
  mapping(uint256 => int128) public slopeChanges;
  mapping(address => LockedBalance) public locked;

  /// @notice A record of each accounts delegate
  mapping(address => address) public delegates;

  mapping(address => mapping(uint32 => Boost)) private _boost;

  /// @notice The number of checkpoints for each account
  mapping(address => uint32) public numCheckpoints;

  // The EIP-712 typehash for the contract's domain
  bytes32 public constant DOMAIN_TYPEHASH =
    keccak256(
      "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
    );

  // The EIP-712 typehash for the delegation struct used by the contract
  bytes32 public constant DELEGATION_TYPEHASH =
    keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");

  // A record of states for signing / validating signatures
  mapping(address => uint256) public nonces;

  // Voting token - Checkpointed view only ERC20
  // EIP-20 token name for this token
  string public constant name = "Staked Ribbon";
  // EIP-20 token symbol for this token
  string public constant symbol = "sRBN";
  // EIP-20 token decimals for this token
  uint8 public constant decimals = 18;

  /** Structs */
  struct Point {
    int128 bias;
    int128 slope;
    uint128 ts;
    uint128 blk;
  }

  struct Boost {
    uint32 nextExpiry;
    uint32 fromBlock;
    uint32 fromTimestamp;
    int128 delegatedSlope;
    int128 receivedSlope;
    uint256 delegatedBias;
    uint256 receivedBias;
  }

  struct LockedBalance {
    int112 amount;
    int112 shares;
    uint32 end;
  }

  enum LockAction {
    CREATE_LOCK,
    INCREASE_LOCK_AMOUNT,
    INCREASE_LOCK_TIME
  }

  /**
   * @dev Constructor
   * @param _stakingToken the staking token to lock
   * @param _owner the owner of the contract
   * @param _rbnRedeemer the contract address with redeeming logic
   */
  constructor(
    address _stakingToken,
    address _owner,
    address _rbnRedeemer
  ) {
    require(_stakingToken != address(0), "!_stakingToken");
    require(_owner != address(0), "!_owner");
    require(_rbnRedeemer != address(0), "!_rbnRedeemer");

    stakingToken = IERC20(_stakingToken);
    Point memory init = Point({
      bias: int128(0),
      slope: int128(0),
      ts: uint128(block.timestamp),
      blk: uint128(block.number)
    });
    pointHistory.push(init);

    transferOwnership(_owner);

    rbnRedeemer = _rbnRedeemer;
  }

  /**
   * @dev Check if the call is from a whitelisted smart contract, revert if not
   * @param _addr address to be checked
   */
  function checkIsWhitelisted(address _addr) internal view {
    address checker = smartWalletChecker;
    require(
      (_addr == tx.origin && !Address.isContract(_addr)) ||
        (checker != address(0) && ISmartWalletChecker(checker).check(_addr)),
      "Smart contract depositors not allowed"
    );
  }

  /**
   * @notice It's stupid to split this out to a different function, but we are trying to save bytecode here
   */
  function checkIsContractStopped() internal view {
    require(!contractStopped, "Contract is stopped");
  }

  /***************************************
                LOCKUP - GETTERS
    ****************************************/

  /**
   * @dev Redeems rbn to redeemer contract in case criterium met (i.e smart contract hack, vaults get rekt)
   * @param _amount amount to withdraw to redeemer contract
   */
  function redeemRBN(uint256 _amount) external {
    address redeemer = rbnRedeemer;
    require(msg.sender == redeemer, "Must be rbn redeemer contract");
    stakingToken.safeTransfer(redeemer, _amount);
    totalLocked -= _amount;
  }

  /**
   * @dev Set rbn redeemer
   * @param _rbnRedeemer new rbn redeemer
   */
  function setRBNRedeemer(address _rbnRedeemer) external onlyOwner {
    rbnRedeemer = _rbnRedeemer;
  }

  /**
   * @dev Set an external contract to check for approved smart contract wallets
   * @param _addr amount to withdraw to redeemer contract
   */
  function commitSmartWalletChecker(address _addr) external onlyOwner {
    futureSmartWalletChecker = _addr;
    emit CommitSmartWalletChecker(_addr);
  }

  /**
   * @dev Apply setting external contract to check approved smart contract wallets
   */
  function applySmartWalletChecker() external onlyOwner {
    smartWalletChecker = futureSmartWalletChecker;
    emit ApplySmartWalletChecker(futureSmartWalletChecker);
  }

  /**
   * @dev Gets the last available user point
   * @param _addr User address
   * @return bias i.e. y
   * @return slope i.e. linear gradient
   * @return ts i.e. time point was logged
   */
  function getLastUserPoint(address _addr)
    external
    view
    override
    returns (
      int128 bias,
      int128 slope,
      uint128 ts
    )
  {
    uint256 uepoch = userPointEpoch[_addr];
    if (uepoch == 0) {
      return (0, 0, 0);
    }
    Point memory point = userPointHistory[_addr][uepoch];
    return (point.bias, point.slope, point.ts);
  }

  /***************************************
                    LOCKUP
    ****************************************/

  /**
   * @dev Records a checkpoint of both individual and global slope
   * @param _addr User address, or address(0) for only global
   * @param _oldLocked Old amount that user had locked, or null for global
   * @param _newLocked new amount that user has locked, or null for global
   */
  function _checkpoint(
    address _addr,
    LockedBalance memory _oldLocked,
    LockedBalance memory _newLocked
  ) internal {
    Point memory userOldPoint;
    Point memory userNewPoint;
    int128 oldSlopeDelta = 0;
    int128 newSlopeDelta = 0;
    uint256 epoch = globalEpoch;

    if (_addr != address(0)) {
      // Calculate slopes and biases
      // Kept at zero when they have to
      if (_oldLocked.end > block.timestamp && _oldLocked.amount > 0) {
        userOldPoint.slope =
          _oldLocked.amount /
          StableMath.toInt112(int256(MAXTIME));
        userOldPoint.bias =
          userOldPoint.slope *
          SafeCast.toInt128(int256(_oldLocked.end - block.timestamp));
      }
      if (_newLocked.end > block.timestamp && _newLocked.amount > 0) {
        userNewPoint.slope =
          _newLocked.amount /
          StableMath.toInt112(int256(MAXTIME));
        userNewPoint.bias =
          userNewPoint.slope *
          SafeCast.toInt128(int256(_newLocked.end - block.timestamp));
      }

      // Moved from bottom final if statement to resolve stack too deep err
      // start {
      // Now handle user history
      uint256 uEpoch = userPointEpoch[_addr];
      if (uEpoch == 0) {
        userPointHistory[_addr].push(userOldPoint);
      }

      userPointEpoch[_addr] = uEpoch + 1;
      userNewPoint.ts = uint128(block.timestamp);
      userNewPoint.blk = uint128(block.number);
      userPointHistory[_addr].push(userNewPoint);

      // Read values of scheduled changes in the slope
      // oldLocked.end can be in the past and in the future
      // newLocked.end can ONLY by in the FUTURE unless everything expired: than zeros
      oldSlopeDelta = slopeChanges[_oldLocked.end];
      if (_newLocked.end != 0) {
        if (_newLocked.end == _oldLocked.end) {
          newSlopeDelta = oldSlopeDelta;
        } else {
          newSlopeDelta = slopeChanges[_newLocked.end];
        }
      }
    }

    Point memory lastPoint = Point({
      bias: 0,
      slope: 0,
      ts: uint128(block.timestamp),
      blk: uint128(block.number)
    });
    if (epoch > 0) {
      lastPoint = pointHistory[epoch];
    }
    uint256 lastCheckpoint = lastPoint.ts;

    // initialLastPoint is used for extrapolation to calculate block number
    // (approximately, for *At methods) and save them
    // as we cannot figure that out exactly from inside the contract
    Point memory initialLastPoint = Point({
      bias: 0,
      slope: 0,
      ts: lastPoint.ts,
      blk: lastPoint.blk
    });
    uint256 blockSlope = 0; // dblock/dt
    if (block.timestamp > lastPoint.ts) {
      blockSlope =
        StableMath.scaleInteger(block.number - lastPoint.blk) /
        (block.timestamp - lastPoint.ts);
    }
    // If last point is already recorded in this block, slope=0
    // But that's ok b/c we know the block in such case

    // Go over weeks to fill history and calculate what the current point is
    uint256 iterativeTime = _floorToWeek(lastCheckpoint);
    for (uint256 i = 0; i < 255; i++) {
      // Hopefully it won't happen that this won't get used in 5 years!
      // If it does, users will be able to withdraw but vote weight will be broken
      iterativeTime = iterativeTime + WEEK;
      int128 dSlope = 0;
      if (iterativeTime > block.timestamp) {
        iterativeTime = block.timestamp;
      } else {
        dSlope = slopeChanges[iterativeTime];
      }
      int128 biasDelta = lastPoint.slope *
        SafeCast.toInt128(int256((iterativeTime - lastCheckpoint)));
      lastPoint.bias = lastPoint.bias - biasDelta;
      lastPoint.slope = lastPoint.slope + dSlope;
      // This can happen
      if (lastPoint.bias < 0) {
        lastPoint.bias = 0;
      }
      // This cannot happen - just in case
      if (lastPoint.slope < 0) {
        lastPoint.slope = 0;
      }
      lastCheckpoint = iterativeTime;
      lastPoint.ts = uint128(iterativeTime);
      lastPoint.blk = uint128(
        initialLastPoint.blk +
          blockSlope.mulTruncate(iterativeTime - initialLastPoint.ts)
      );

      // when epoch is incremented, we either push here or after slopes updated below
      epoch = epoch + 1;
      if (iterativeTime == block.timestamp) {
        lastPoint.blk = uint128(block.number);
        break;
      } else {
        pointHistory.push(lastPoint);
      }
    }

    globalEpoch = epoch;
    // Now pointHistory is filled until t=now

    if (_addr != address(0)) {
      // If last point was in this block, the slope change has been applied already
      // But in such case we have 0 slope(s)
      lastPoint.slope =
        lastPoint.slope +
        userNewPoint.slope -
        userOldPoint.slope;
      lastPoint.bias = lastPoint.bias + userNewPoint.bias - userOldPoint.bias;
      if (lastPoint.slope < 0) {
        lastPoint.slope = 0;
      }
      if (lastPoint.bias < 0) {
        lastPoint.bias = 0;
      }
    }

    // Record the changed point into history
    // pointHistory[epoch] = lastPoint;
    pointHistory.push(lastPoint);

    if (_addr != address(0)) {
      // Schedule the slope changes (slope is going down)
      // We subtract new_user_slope from [new_locked.end]
      // and add old_user_slope to [old_locked.end]
      if (_oldLocked.end > block.timestamp) {
        // oldSlopeDelta was <something> - userOldPoint.slope, so we cancel that
        oldSlopeDelta = oldSlopeDelta + userOldPoint.slope;
        if (_newLocked.end == _oldLocked.end) {
          oldSlopeDelta = oldSlopeDelta - userNewPoint.slope; // It was a new deposit, not extension
        }
        slopeChanges[_oldLocked.end] = oldSlopeDelta;
      }
      if (_newLocked.end > block.timestamp) {
        if (_newLocked.end > _oldLocked.end) {
          newSlopeDelta = newSlopeDelta - userNewPoint.slope; // old slope disappeared at this point
          slopeChanges[_newLocked.end] = newSlopeDelta;
        }
        // else: we recorded it already in oldSlopeDelta
      }
    }
  }

  /**
   * @dev Deposits or creates a stake for a given address
   * @param _addr User address to assign the stake
   * @param _value Total units of StakingToken to lockup
   * @param _unlockTime Time at which the stake should unlock
   * @param _oldLocked Previous amount staked by this user
   * @param _action See LockAction enum
   */
  function _depositFor(
    address _addr,
    uint256 _value,
    uint256 _unlockTime,
    LockedBalance memory _oldLocked,
    LockAction _action
  ) internal {
    LockedBalance memory newLocked = LockedBalance({
      amount: _oldLocked.amount,
      shares: _oldLocked.shares,
      end: _oldLocked.end
    });

    uint256 _newShares;
    uint256 _totalRBN = stakingToken.balanceOf(address(this));
    if (totalShares == 0 || _totalRBN == 0) {
      _newShares = _value;
    } else {
      _newShares = _value.mul(totalShares).div(_totalRBN);
    }

    require(_newShares > 0 || _action == LockAction.INCREASE_LOCK_TIME, "!(new shares > 0)")

    // Adding to existing lock, or if a lock is expired - creating a new one
    newLocked.amount = newLocked.amount + StableMath.toInt112(int256(_value));
    newLocked.shares =
      newLocked.shares +
      StableMath.toInt112(int256(_newShares));

    totalShares += _newShares;
    totalLocked += _value;

    if (_unlockTime != 0) {
      newLocked.end = SafeCast.toUint32(_unlockTime);
    }
    locked[_addr] = newLocked;

    // Possibilities:
    // Both _oldLocked.end could be current or expired (>/< block.timestamp)
    // value == 0 (extend lock) or value > 0 (add to lock or extend lock)
    // newLocked.end > block.timestamp (always)
    _checkpoint(_addr, _oldLocked, newLocked);

    if (_value != 0) {
      stakingToken.safeTransferFrom(_addr, address(this), _value);
    }
    emit Deposit(_addr, _value, newLocked.end, _action, block.timestamp);
  }

  /**
   * @dev Public function to trigger global checkpoint
   */
  function checkpoint() external {
    LockedBalance memory empty;
    _checkpoint(address(0), empty, empty);
  }

  /**
   * @dev Creates a new lock
   * @param _value Total units of StakingToken to lockup
   * @param _unlockTime Time at which the stake should unlock
   */
  function createLock(uint256 _value, uint256 _unlockTime)
    external
    override
    nonReentrant
  {
    checkIsWhitelisted(msg.sender);
    checkIsContractStopped();

    uint256 unlock_time = _floorToWeek(_unlockTime); // Locktime is rounded down to weeks
    LockedBalance memory locked_ = LockedBalance({
      amount: locked[msg.sender].amount,
      shares: locked[msg.sender].shares,
      end: locked[msg.sender].end
    });

    require(_value > 0, "Must stake non zero amount");
    require(locked_.amount == 0, "Withdraw old tokens first");

    require(
      unlock_time > block.timestamp,
      "Can only lock until time in the future"
    );
    require(
      unlock_time <= block.timestamp + MAXTIME,
      "Voting lock can be 4 years max"
    );

    _depositFor(
      msg.sender,
      _value,
      unlock_time,
      locked_,
      LockAction.CREATE_LOCK
    );
  }

  /**
   * @dev Increases amount of stake thats locked up & resets decay
   * @param _value Additional units of StakingToken to add to exiting stake
   */
  function increaseLockAmount(uint256 _value)
    external
    override
    nonReentrant
  {
    checkIsWhitelisted(msg.sender);
    checkIsContractStopped();

    LockedBalance memory locked_ = LockedBalance({
      amount: locked[msg.sender].amount,
      shares: locked[msg.sender].shares,
      end: locked[msg.sender].end
    });

    require(_value > 0, "Must stake non zero amount");
    require(locked_.amount > 0, "No existing lock found");
    require(
      locked_.end > block.timestamp,
      "Cannot add to expired lock. Withdraw"
    );

    _depositFor(
      msg.sender,
      _value,
      0,
      locked_,
      LockAction.INCREASE_LOCK_AMOUNT
    );
  }

  /**
   * @dev Increases length of lockup & resets decay
   * @param _unlockTime New unlocktime for lockup
   */
  function increaseLockLength(uint256 _unlockTime)
    external
    override
    nonReentrant
  {
    checkIsWhitelisted(msg.sender);
    checkIsContractStopped();

    LockedBalance memory locked_ = LockedBalance({
      amount: locked[msg.sender].amount,
      shares: locked[msg.sender].shares,
      end: locked[msg.sender].end
    });
    uint256 unlock_time = _floorToWeek(_unlockTime); // Locktime is rounded down to weeks

    require(locked_.amount > 0, "Nothing is locked");
    require(locked_.end > block.timestamp, "Lock expired");
    require(unlock_time > locked_.end, "Can only increase lock WEEK");
    require(
      unlock_time <= block.timestamp + MAXTIME,
      "Voting lock can be 4 years max"
    );

    _depositFor(
      msg.sender,
      0,
      unlock_time,
      locked_,
      LockAction.INCREASE_LOCK_TIME
    );
  }

  /**
   * @dev Withdraws all the senders stake, providing lockup is over
   */
  function withdraw() external override nonReentrant {
    address _addr = msg.sender;

    LockedBalance memory oldLock = LockedBalance({
      end: locked[_addr].end,
      shares: locked[_addr].shares,
      amount: locked[_addr].amount
    });
    require(block.timestamp >= oldLock.end, "The lock didn't expire");
    require(oldLock.amount > 0, "Must have something to withdraw");

    uint256 shares = SafeCast.toUint256(oldLock.shares);

    LockedBalance memory currentLock = LockedBalance({
      end: 0,
      shares: 0,
      amount: 0
    });
    locked[_addr] = currentLock;

    // oldLocked can have either expired <= timestamp or zero end
    // currentLock has only 0 end
    // Both can have >= 0 amount
    _checkpoint(_addr, oldLock, currentLock);

    uint256 value = shares.mul(stakingToken.balanceOf(address(this))).div(
      totalShares
    );
    totalShares -= shares;
    totalLocked -= value;

    stakingToken.safeTransfer(_addr, value);

    emit Withdraw(_addr, value, block.timestamp);
  }

  /**
   * @dev Stops the contract.
   * No more staking can happen. Only withdraw.
   * @param _contractStopped whether contract is stopped
   */
  function setContractStopped(bool _contractStopped) external onlyOwner {
    contractStopped = _contractStopped;

    emit ContractStopped(_contractStopped);
  }

  /**
   * @notice Delegate votes from `msg.sender` to `delegatee`
   * @param delegatee The address to delegate votes to
   */
  function delegate(address delegatee) external {
    return _delegate(msg.sender, delegatee);
  }

  /**
   * @notice Delegates votes from signatory to `delegatee`
   * @param _delegatee The address to delegate votes to
   * @param _nonce The contract state required to match the signature
   * @param _expiry The time at which to expire the signature
   * @param _v The recovery byte of the signature
   * @param _r Half of the ECDSA signature pair
   * @param _s Half of the ECDSA signature pair
   */
  function delegateBySig(
    address _delegatee,
    uint256 _nonce,
    uint256 _expiry,
    uint8 _v,
    bytes32 _r,
    bytes32 _s
  ) external {
    bytes32 domainSeparator = keccak256(
      abi.encode(
        DOMAIN_TYPEHASH,
        keccak256(bytes(name)),
        getChainId(),
        address(this)
      )
    );
    bytes32 structHash = keccak256(
      abi.encode(DELEGATION_TYPEHASH, _delegatee, _nonce, _expiry)
    );
    bytes32 digest = keccak256(
      abi.encodePacked("\x19\x01", domainSeparator, structHash)
    );
    address signatory = ecrecover(digest, _v, _r, _s);
    require(signatory != address(0), "sRBN::delegateBySig: invalid signature");
    require(
      _nonce == nonces[signatory]++,
      "sRBN::delegateBySig: invalid nonce"
    );
    require(
      block.timestamp <= _expiry,
      "sRBN::delegateBySig: signature expired"
    );
    return _delegate(signatory, _delegatee);
  }

  /**
   * @notice Delegates votes from signatory to `delegatee`
   * @param delegatee The address to delegate votes to
   * @param delegatee The address to delegate votes to
   */
  function _delegate(address delegator, address delegatee) internal {
    address delegateeStored = delegates[delegator];

    // Requirements
    // a) delegating more to same delegatee as before OR switching delegates
    // b) has existing delegation when cancelling delegation
    // c) cannot delegate to oneself

    require(
      (delegateeStored == address(0) && delegatee != address(0)) ||
        delegateeStored != address(0),
      "Cannot cancel delegation without existing delegation"
    );

    require(delegator != delegatee, "Cannot delegate to oneself");

    uint96 delegatorBalance;
    uint96 boostExpiry;

    // If we are not delegating to zero address (cancelling delegation)
    if (delegatee != address(0)) {
      delegatorBalance = balanceOf(delegator);
      boostExpiry = locked[delegator].end;
    }

    // Change the delegator's delegatee
    if (delegateeStored != delegatee) {
      delegates[delegator] = delegatee;
    }

    _moveDelegates(
      delegator,
      delegatee,
      delegateeStored,
      boostExpiry,
      delegatorBalance
    );

    emit DelegateSet(delegator, delegatee, delegatorBalance, boostExpiry);
  }

  /**
   * @dev Update delegation logic
   * @param _delegator address of the delegator
   * @param _receiver address of the delegatee
   * @param _oldReceiver address of the old delegatee
   * @param _expireTime time when the rbn boost expires
   * @param _amt balance of the
   */
  function _moveDelegates(
    address _delegator,
    address _receiver,
    address _oldReceiver,
    uint256 _expireTime,
    uint256 _amt
  ) internal {
    bool isCancelDelegation = _receiver == address(0);
    // If we are transferring delegations from one EOA to another
    bool isTransferDelegation = !isCancelDelegation &&
      _oldReceiver != address(0) &&
      _receiver != _oldReceiver;

    uint32 nCheckpointsDelegator = numCheckpoints[_delegator];
    uint32 nCheckpointsReceiver = numCheckpoints[_receiver];

    uint128 nextExpiry = nCheckpointsDelegator > 0
      ? _boost[_delegator][nCheckpointsDelegator - 1].nextExpiry
      : 0;

    // Update the next expiry to be _expireTime if we have no current
    // delegation
    if (!isCancelDelegation && nextExpiry == 0) {
      nextExpiry = type(uint128).max;
    }

    require(
      isCancelDelegation || block.timestamp < nextExpiry,
      "Delegated a now expired boost in the past. Please cancel"
    );

    // delegated slope and bias
    uint256 delegatedBias = nCheckpointsDelegator > 0
      ? _boost[_delegator][nCheckpointsDelegator - 1].delegatedBias
      : 0;
    int128 delegatedSlope = nCheckpointsDelegator > 0
      ? _boost[_delegator][nCheckpointsDelegator - 1].delegatedSlope
      : int128(0);

    int128 slope;
    uint256 bias;

    if (!isCancelDelegation) {
      // delegated boost will be positive, if any of circulating boosts are negative
      // we have already reverted
      int256 delegatedBoost = delegatedSlope *
        SafeCast.toInt256(block.timestamp) +
        SafeCast.toInt256(delegatedBias);
      int256 y = SafeCast.toInt256(_amt) -
        (isTransferDelegation ? int256(0) : delegatedBoost);

      require(y > 0, "No boost available");

      uint256 expireTime = (_expireTime / 1 weeks) * 1 weeks;

      (int128 _slope, uint256 _bias) = _calcBiasSlope(
        SafeCast.toInt256(block.timestamp),
        y,
        SafeCast.toInt256(expireTime)
      );

      require(_slope < 0, "invalid slope");

      slope = _slope;
      bias = _bias;

      // increase the expiry of the sRBN boost
      if (expireTime < nextExpiry) {
        nextExpiry = SafeCast.toUint128(expireTime);
      }
    }

    // Cancel the previous delegation if we are transferring
    // delegations
    if (isTransferDelegation) {
      _writeDelegatorCheckpoint(
        _delegator,
        address(0),
        nCheckpointsDelegator,
        slope,
        bias,
        nextExpiry,
        SafeCast.toUint128(block.number),
        SafeCast.toUint128(block.timestamp)
      );

      _writeReceiverCheckpoint(
        _oldReceiver,
        address(0),
        nCheckpointsReceiver,
        delegatedBias,
        delegatedSlope,
        slope,
        bias,
        SafeCast.toUint128(block.number),
        SafeCast.toUint128(block.timestamp)
      );

      nCheckpointsDelegator = numCheckpoints[_delegator];
    }

    // Creating delegation for delegator / receiver of delegation
    _writeDelegatorCheckpoint(
      _delegator,
      _receiver,
      nCheckpointsDelegator,
      slope,
      bias,
      nextExpiry,
      SafeCast.toUint128(block.number),
      SafeCast.toUint128(block.timestamp)
    );

    _writeReceiverCheckpoint(
      _oldReceiver,
      _receiver,
      nCheckpointsReceiver,
      delegatedBias,
      delegatedSlope,
      slope,
      bias,
      SafeCast.toUint128(block.number),
      SafeCast.toUint128(block.timestamp)
    );
  }

  /**
   * @dev Update delegator side delegation logic
   * @param _delegator address of the delegator
   * @param _receiver address of the delegatee
   * @param _nCheckpoints index of next checkpoint
   * @param _slope slope of boost
   * @param _bias bias of boost (y-intercept)
   * @param _nextExpiry expiry of the boost
   * @param _blk current block number
   * @param _ts current timestamp
   */
  function _writeDelegatorCheckpoint(
    address _delegator,
    address _receiver,
    uint32 _nCheckpoints,
    int128 _slope,
    uint256 _bias,
    uint128 _nextExpiry,
    uint128 _blk,
    uint128 _ts
  ) internal {
    bool isCancelDelegation = _receiver == address(0);

    Boost memory addrBoost = _nCheckpoints > 0
      ? _boost[_delegator][_nCheckpoints - 1]
      : Boost(0, 0, 0, 0, 0, 0, 0);

    // If the previous checkpoint is the same block number
    // we will update same checkpoint with new delegation
    // updates
    uint32 currCP = _nCheckpoints > 0 && addrBoost.fromBlock == _blk
      ? _nCheckpoints - 1
      : _nCheckpoints;

    // If we are cancelling delegation, we set delegation
    // slope, bias, and next expiry to 0. Otherwise, we increment
    // the delegated slope, the delegated bias, and update the nextExpiry
    _boost[_delegator][currCP] = Boost({
      delegatedSlope: isCancelDelegation ? int128(0) : addrBoost.delegatedSlope + _slope,
      delegatedBias: uint256(isCancelDelegation ? 0 : addrBoost.delegatedBias + _bias),
      receivedSlope: addrBoost.receivedSlope,
      receivedBias: uint256(addrBoost.receivedBias),
      nextExpiry: uint32(isCancelDelegation ? 0 : _nextExpiry),
      fromBlock: uint32(currCP == _nCheckpoints ? _blk : addrBoost.fromBlock),
      fromTimestamp: uint32(currCP == _nCheckpoints ? _ts : addrBoost.fromTimestamp)
    });

    if (currCP == _nCheckpoints) {
      numCheckpoints[_delegator] = _nCheckpoints + 1;
    }
  }

  /**
   * @dev Update delegatee side delegation logic
   * @param _oldReceiver address of the old delegatee of delegator
   * @param _newReceiver address of the new delegatee of delegatee
   * @param _nCheckpoints index of next checkpoint
   * @param _delegatedBias bias of delegator
   * @param _delegatedSlope slope of delegator
   * @param _slope slope of boost
   * @param _bias bias of boost (y-intercept)
   * @param _blk current block number
   * @param _ts current timestamp
   */
  function _writeReceiverCheckpoint(
    address _oldReceiver,
    address _newReceiver,
    uint32 _nCheckpoints,
    uint256 _delegatedBias,
    int128 _delegatedSlope,
    int128 _slope,
    uint256 _bias,
    uint128 _blk,
    uint128 _ts
  ) internal {
    bool isCancelDelegation = _newReceiver == address(0);
    address receiver = isCancelDelegation ? _oldReceiver : _newReceiver;

    Boost memory addrBoost = _nCheckpoints > 0
      ? _boost[receiver][_nCheckpoints - 1]
      : Boost(0, 0, 0, 0, 0, 0, 0);

    // If this is not the first checkpoint, if it is a
    // cancellation we subtract the delegated bias and
    // slope of this delegator from the delegatee.
    // Otherwise we increment the bias and slope.
    if (_nCheckpoints > 0) {
      if (isCancelDelegation) {
        addrBoost.receivedBias -= _delegatedBias;
        addrBoost.receivedSlope -= _delegatedSlope;
      } else {
        addrBoost.receivedBias += _bias;
        addrBoost.receivedSlope += _slope;
      }
    } else {
      // If we are not cancelling, we set the bias
      // and slope
      if (!isCancelDelegation) {
        addrBoost.receivedSlope = _slope;
        addrBoost.receivedBias = _bias;
      }
    }

    uint32 currCP = _nCheckpoints > 0 && addrBoost.fromBlock == _blk
      ? _nCheckpoints - 1
      : _nCheckpoints;

    _boost[receiver][currCP] = Boost({
      delegatedSlope: addrBoost.delegatedSlope,
      receivedSlope: addrBoost.receivedSlope,
      delegatedBias: addrBoost.delegatedBias,
      receivedBias: addrBoost.receivedBias,
      nextExpiry: addrBoost.nextExpiry,
      fromBlock: currCP == _nCheckpoints ? uint32(_blk) : addrBoost.fromBlock,
      fromTimestamp: currCP == _nCheckpoints ? uint32(_ts) : addrBoost.fromTimestamp
    });

    if (currCP == _nCheckpoints) {
      numCheckpoints[receiver] = _nCheckpoints + 1;
    }
  }

  /***************************************
                    GETTERS
    ****************************************/

  /** @dev Floors a timestamp to the nearest weekly increment */
  function _floorToWeek(uint256 _t) internal pure returns (uint256) {
    return (_t / WEEK) * WEEK;
  }

  /**
   * @dev Uses binarysearch to find the most recent (user) point history preceeding block
   * @param _block Find the most recent point history before this block
   * @param _max Do not search pointHistories past this index
   * @param _addr User for which to search
   */
  function _findBlockEpoch(
    uint256 _block,
    uint256 _max,
    address _addr
  ) internal view returns (uint256) {
    bool isUserBlock = _addr != address(0);
    // Binary search
    uint256 min = 0;
    uint256 max = _max;
    // Will be always enough for 128-bit numbers
    for (uint256 i = 0; i < 128; i++) {
      if (min >= max) break;
      uint256 mid = (min + max + 1) / 2;
      if (
        (
          isUserBlock ? userPointHistory[_addr][mid].blk : pointHistory[mid].blk
        ) <= _block
      ) {
        min = mid;
      } else {
        max = mid - 1;
      }
    }
    return min;
  }

  /**
   * @dev Uses binarysearch to find the most recent user point history delegation preceeding block
   * @param _addr User for which to search
   * @param _block Find the most recent point history before this block
   * @return delegatedBias, delegatedSlope, receivedBias, receivedSlope, nextExpiry, fromTimestamp
   */
  function _findDelegationBlockEpoch(address _addr, uint256 _block)
    internal
    view
    returns (
      uint256,
      int128,
      uint256,
      int128,
      uint32,
      uint32
    )
  {
    require(_block <= block.number, "sRBN::getPriorVotes: not yet determined");

    uint32 nCheckpoints = numCheckpoints[_addr];

    if (nCheckpoints == 0) {
      return (0, 0, 0, 0, 0, 0);
    }

    Boost memory cp;

    // First check most recent balance
    if (_boost[_addr][nCheckpoints - 1].fromBlock <= _block) {
      cp = _boost[_addr][nCheckpoints - 1];

      return (
        cp.delegatedBias,
        cp.delegatedSlope,
        cp.receivedBias,
        cp.receivedSlope,
        cp.nextExpiry,
        cp.fromTimestamp
      );
    }

    // Next check implicit zero balance
    if (_boost[_addr][0].fromBlock > _block) {
      return (0, 0, 0, 0, 0, 0);
    }

    uint32 lower = 0;
    uint32 upper = nCheckpoints - 1;
    while (upper > lower) {
      uint32 center = upper - (upper - lower) / 2; // ceil, avoiding overflow
      cp = _boost[_addr][center];
      if (cp.fromBlock == _block) {
        return (
          cp.delegatedBias,
          cp.delegatedSlope,
          cp.receivedBias,
          cp.receivedSlope,
          cp.nextExpiry,
          cp.fromTimestamp
        );
      } else if (cp.fromBlock < _block) {
        lower = center;
      } else {
        upper = center - 1;
      }
    }
    cp = _boost[_addr][lower];
    return (
      cp.delegatedBias,
      cp.delegatedSlope,
      cp.receivedBias,
      cp.receivedSlope,
      cp.nextExpiry,
      cp.fromTimestamp
    );
  }

  /**
   * @dev Calculates slope and bias using y = mx + b
   * @param _x current timestamp
   * @param _y current boost size
   * @param _expireTime expiry of boost
   * @return slope slope of boost
   * @return bias bias of boost
   */
  function _calcBiasSlope(
    int256 _x,
    int256 _y,
    int256 _expireTime
  ) internal pure returns (int128 slope, uint256 bias) {
    // SLOPE: (y2 - y1) / (x2 - x1)
    // BIAS: y = mx + b -> y - mx = b
    slope = SafeCast.toInt128(-_y / (_expireTime - _x));
    bias = SafeCast.toUint256(_y - slope * _x);
  }

  /**
   * @dev Calculates the boost size, slope, and bias
   * @param _addr address to check boost for
   * @param _isDelegator whether address is delegator or receiver of boost
   * @return boost size, slope, bias
   */
  function checkBoost(address _addr, bool _isDelegator)
    external
    view
    returns (
      uint256,
      int128,
      uint256
    )
  {
    uint32 nCheckpoints = numCheckpoints[_addr];

    // No boost exists
    if (nCheckpoints == 0 || (delegates[_addr] == address(0) && _isDelegator)) {
      return (0, 0, 0);
    }

    Boost memory addrBoost = _boost[_addr][nCheckpoints - 1];

    // No boost exists
    if (addrBoost.nextExpiry == 0 && _isDelegator) {
      return (0, 0, 0);
    }

    uint256 bias = _isDelegator
      ? addrBoost.delegatedBias
      : addrBoost.receivedBias;
    int128 slope = _isDelegator
      ? addrBoost.delegatedSlope
      : addrBoost.receivedSlope;

    int256 balance = slope *
      SafeCast.toInt256(block.timestamp) +
      SafeCast.toInt256(bias);

    // If we are delegator we get abs(balance)
    // If we are receiver we get min(balance, 0) of balance
    if (_isDelegator) {
      return (SafeCast.toUint256(StableMath.abs(balance)), slope, bias);
    } else {
      return (balance > 0 ? SafeCast.toUint256(balance) : 0, slope, bias);
    }
  }

  /**
   * @dev Gets current user voting weight (aka effectiveStake)
   * @dev Does not include delegations
   * @param _owner User for which to return the balance
   * @return uint96 Balance of user
   */
  function balanceOf(address _owner) public view returns (uint96) {
    uint256 epoch = userPointEpoch[_owner];
    if (epoch == 0) {
      return 0;
    }
    Point memory lastPoint = userPointHistory[_owner][epoch];
    lastPoint.bias =
      lastPoint.bias -
      (lastPoint.slope *
        SafeCast.toInt128(SafeCast.toInt256(block.timestamp - lastPoint.ts)));
    if (lastPoint.bias < 0) {
      lastPoint.bias = 0;
    }

    return SafeCast.toUint96(SafeCast.toUint256(lastPoint.bias));
  }

  /**
   * @dev Gets current user voting weight (aka effectiveStake) for a specific block
   * @dev Does not include delegations
   * @param _owner User for which to return the balance
   * @param _blockNumber Block number to check
   * @return uint96 Balance of user
   */
  function balanceOfAt(address _owner, uint256 _blockNumber)
    public
    view
    returns (uint96)
  {
    require(_blockNumber <= block.number, "Must pass block number in the past");

    // Get most recent user Point to block
    uint256 userEpoch = _findBlockEpoch(
      _blockNumber,
      userPointEpoch[_owner],
      _owner
    );
    if (userEpoch == 0) {
      return 0;
    }
    Point memory upoint = userPointHistory[_owner][userEpoch];

    // Get most recent global Point to block
    uint256 maxEpoch = globalEpoch;
    uint256 epoch = _findBlockEpoch(_blockNumber, maxEpoch, address(0));
    Point memory point0 = pointHistory[epoch];

    // Calculate delta (block & time) between user Point and target block
    // Allowing us to calculate the average seconds per block between
    // the two points
    uint256 dBlock = 0;
    uint256 dTime = 0;
    if (epoch < maxEpoch) {
      Point memory point1 = pointHistory[epoch + 1];
      dBlock = point1.blk - point0.blk;
      dTime = point1.ts - point0.ts;
    } else {
      dBlock = block.number - point0.blk;
      dTime = block.timestamp - point0.ts;
    }
    // (Deterministically) Estimate the time at which block _blockNumber was mined
    uint256 blockTime = point0.ts;
    if (dBlock != 0) {
      blockTime = blockTime + ((dTime * (_blockNumber - point0.blk)) / dBlock);
    }
    // Current Bias = most recent bias - (slope * time since update)
    upoint.bias =
      upoint.bias -
      (upoint.slope * SafeCast.toInt128(int256(blockTime - upoint.ts)));
    if (upoint.bias >= 0) {
      return SafeCast.toUint96(SafeCast.toUint256(upoint.bias));
    } else {
      return 0;
    }
  }

  /**
   * @dev Gets a users votingWeight at a given blockNumber
   * @dev Block number must be a finalized block or else this function will revert to prevent misinformation.
   * @dev Includes delegations
   * @param _owner User for which to return the balance
   * @param _blockNumber Block at which to calculate balance
   * @return uint96 Balance of user
   */
  function getPriorVotes(address _owner, uint256 _blockNumber)
    public
    view
    override
    returns (uint96)
  {
    uint96 adjustedBalance = balanceOfAt(_owner, _blockNumber);

    (
      uint256 delegatedBias,
      int128 delegatedSlope,
      uint256 receivedBias,
      int128 receivedSlope,
      uint128 nextExpiry,
      uint128 ts
    ) = _findDelegationBlockEpoch(_owner, _blockNumber);

    if (nextExpiry != 0 && nextExpiry < ts) {
      // if the account has a negative boost in circulation
      // we over penalize by setting their adjusted balance to 0
      // this is because we don't want to iterate to find the real
      // value
      return 0;
    }

    if (delegatedBias != 0) {
      // we take the absolute value, since delegated boost can be negative
      // if any outstanding negative boosts are in circulation
      // this can inflate the vecrv balance of a user
      // taking the absolute value has the effect that it costs
      // a user to negatively impact another's vecrv balance
      adjustedBalance -= SafeCast.toUint96(
        SafeCast.toUint256(
          StableMath.abs(
            delegatedSlope *
              SafeCast.toInt256(block.timestamp) +
              SafeCast.toInt256(delegatedBias)
          )
        )
      );
    }

    if (receivedBias != 0) {
      // similar to delegated boost, our received boost can be negative
      // if any outstanding negative boosts are in our possession
      // However, unlike delegated boost, we do not negatively impact
      // our adjusted balance due to negative boosts. Instead we take
      // whichever is greater between 0 and the value of our received
      // boosts.
      int256 receivedBoost = receivedSlope *
        SafeCast.toInt256(block.timestamp) +
        SafeCast.toInt256(receivedBias);
      adjustedBalance += SafeCast.toUint96(
        uint256((receivedBoost > 0 ? SafeCast.toUint256(receivedBoost) : 0))
      );
    }

    // since we took the absolute value of our delegated boost, it now instead of
    // becoming negative is positive, and will continue to increase ...
    // meaning if we keep a negative outstanding delegated balance for long
    // enought it will not only decrease our vecrv_balance but also our received
    // boost, however we return the maximum between our adjusted balance and 0
    // when delegating boost, received boost isn't used for determining how
    // much we can delegate.

    return adjustedBalance > 0 ? adjustedBalance : 0;
  }

  /**
   * @dev Calculates total supply of votingWeight at a given time _t
   * @param _point Most recent point before time _t
   * @param _t Time at which to calculate supply
   * @return totalSupply at given point in time
   */
  function _supplyAt(Point memory _point, uint256 _t)
    internal
    view
    returns (uint256)
  {
    Point memory lastPoint = _point;
    // Floor the timestamp to weekly interval
    uint256 iterativeTime = _floorToWeek(lastPoint.ts);
    // Iterate through all weeks between _point & _t to account for slope changes
    for (uint256 i = 0; i < 255; i++) {
      iterativeTime = iterativeTime + WEEK;
      int128 dSlope = 0;
      // If week end is after timestamp, then truncate & leave dSlope to 0
      if (iterativeTime > _t) {
        iterativeTime = _t;
      }
      // else get most recent slope change
      else {
        dSlope = slopeChanges[iterativeTime];
      }

      lastPoint.bias =
        lastPoint.bias -
        (lastPoint.slope *
          SafeCast.toInt128(int256(iterativeTime - lastPoint.ts)));
      if (iterativeTime == _t) {
        break;
      }
      lastPoint.slope = lastPoint.slope + dSlope;
      lastPoint.ts = uint128(iterativeTime);
    }

    if (lastPoint.bias < 0) {
      lastPoint.bias = 0;
    }
    return SafeCast.toUint256(lastPoint.bias);
  }

  /**
   * @dev Calculates current total supply of votingWeight
   * @return totalSupply of voting token weight
   */
  function totalSupply() public view returns (uint256) {
    uint256 epoch_ = globalEpoch;
    Point memory lastPoint = pointHistory[epoch_];
    return _supplyAt(lastPoint, block.timestamp);
  }

  /**
   * @dev Calculates total supply of votingWeight at a given blockNumber (optional)
   * @param _blockNumber Block number at which to calculate total supply
   * @return totalSupply of voting token weight at the given blockNumber
   */
  function totalSupplyAt(uint256 _blockNumber) public view returns (uint256) {
    require(_blockNumber <= block.number, "Must pass block number in the past");

    uint256 epoch = globalEpoch;
    uint256 targetEpoch = _findBlockEpoch(_blockNumber, epoch, address(0));

    Point memory point = pointHistory[targetEpoch];

    // If point.blk > _blockNumber that means we got the initial epoch & contract did not yet exist
    if (point.blk > _blockNumber) {
      return 0;
    }

    uint256 dTime = 0;
    if (targetEpoch < epoch) {
      Point memory pointNext = pointHistory[targetEpoch + 1];
      if (point.blk != pointNext.blk) {
        dTime =
          ((_blockNumber - point.blk) * (pointNext.ts - point.ts)) /
          (pointNext.blk - point.blk);
      }
    } else if (point.blk != block.number) {
      dTime =
        ((_blockNumber - point.blk) * (block.timestamp - point.ts)) /
        (block.number - point.blk);
    }
    // Now dTime contains info on how far are we beyond point

    return _supplyAt(point, point.ts + dTime);
  }

  /**
   * @dev Get chain id
   */
  function getChainId() internal view returns (uint256) {
    uint256 chainId;
    assembly {
      chainId := chainid()
    }
    return chainId;
  }
}
