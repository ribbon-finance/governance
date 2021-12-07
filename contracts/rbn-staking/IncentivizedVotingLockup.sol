// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {
  IIncentivisedVotingLockup
} from "../interfaces/IIncentivisedVotingLockup.sol";
import {
  ReentrancyGuard
} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Detailed} from "../interfaces/IERC20Detailed.sol";
import {ISmartWalletChecker} from "../interfaces/ISmartWalletChecker.sol";
import {
  SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {StableMath} from "../libraries/StableMath.sol";
import {Root} from "../libraries/Root.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title  IncentivisedVotingLockup
 * @author Voting Weight tracking & Decay
 *             -> Curve Finance (MIT) - forked & ported to Solidity
 *             -> https://github.com/curvefi/curve-dao-contracts/blob/master/contracts/VotingEscrow.vy
 *         osolmaz - Research & Reward distributions
 *         alsco77 - Solidity implementation
 * @notice Lockup MTA, receive vMTA (voting weight that decays over time), and earn
 *         rewards based on staticWeight
 * @dev    Supports:
 *            1) Tracking MTA Locked up (LockedBalance)
 *            2) Pull Based Reward allocations based on Lockup (Static Balance)
 *            3) Decaying voting weight lookup through CheckpointedERC20 (balanceOf)
 *            5) Migration of points to v2 (used as multiplier in future) ***** (rewardsPaid)
 *            6) Closure of contract (expire)
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
  /// @notice An event thats emitted when an account changes its delegate
  event DelegateSet(
    address indexed delegator,
    address indexed toDelegate,
    uint96 amount,
    uint96 expireTime
  );
  /// @notice An event thats emitted when an account removes its delegate
  event DelegateRemoved(
    address indexed delegator,
    address indexed delegateeToRemove,
    uint256 amtDelegationRemoved
  );

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
  uint256 public END;

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

  /// @notice The EIP-712 typehash for the contract's domain
  bytes32 public constant DOMAIN_TYPEHASH =
    keccak256(
      "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
    );

  /// @notice The EIP-712 typehash for the delegation struct used by the contract
  bytes32 public constant DELEGATION_TYPEHASH =
    keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");

  /// @notice The EIP-712 typehash for the permit struct used by the contract
  bytes32 public constant PERMIT_TYPEHASH =
    keccak256(
      "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

  /// @notice A record of states for signing / validating signatures
  mapping(address => uint256) public nonces;

  // Voting token - Checkpointed view only ERC20
  /// @notice EIP-20 token name for this token
  string public constant name = "Staked Ribbon";
  /// @notice EIP-20 token symbol for this token
  string public constant symbol = "sRBN";
  /// @notice EIP-20 token decimals for this token
  uint8 public constant decimals = 18;

  /** Structs */
  struct Point {
    int128 bias;
    int128 slope;
    uint128 ts;
    uint128 blk;
  }

  struct Boost {
    uint256 delegatedBias;
    int128 delegatedSlope;
    uint256 receivedBias;
    int128 receivedSlope;
    uint128 nextExpiry;
    uint32 fromBlock;
  }

  struct LockedBalance {
    int112 amount;
    int112 shares;
    uint32 end;
  }

  enum LockAction {CREATE_LOCK, INCREASE_LOCK_AMOUNT, INCREASE_LOCK_TIME}

  constructor(
    address _stakingToken,
    address _owner,
    address _rbnRedeemer
  ) {
    require(_stakingToken != address(0), "!_stakingToken");
    require(_owner != address(0), "!_owner");
    require(_rbnRedeemer != address(0), "!_rbnRedeemer");

    stakingToken = IERC20(_stakingToken);
    Point memory init =
      Point({
        bias: int128(0),
        slope: int128(0),
        ts: uint128(block.timestamp),
        blk: uint128(block.number)
      });
    pointHistory.push(init);

    transferOwnership(_owner);

    rbnRedeemer = _rbnRedeemer;

    END = block.timestamp + MAXTIME;
  }

  /**
   * @dev Check if the call is from a whitelisted smart contract, revert if not
   * @param _addr address to be checked
   */
  modifier isWhitelisted(address _addr) {
    address checker = smartWalletChecker;
    require(
      _addr == tx.origin ||
        (checker != address(0) && ISmartWalletChecker(checker).check(_addr)),
      "Smart contract depositors not allowed"
    );
    _;
  }

  /** @dev Modifier to ensure contract has not stopped */
  modifier contractNotStopped() {
    require(!contractStopped, "Contract is stopped");
    _;
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
   * @dev Set an external contract to check for approved smart contract wallets
   * @param _addr amount to withdraw to redeemer contract
   */
  function commitSmartWalletChecker(address _addr) external onlyOwner {
    futureSmartWalletChecker = _addr;
  }

  /**
   * @dev Apply setting external contract to check approved smart contract wallets
   */
  function applySmartWalletChecker() external onlyOwner {
    smartWalletChecker = futureSmartWalletChecker;
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
      uint256 ts
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

    Point memory lastPoint =
      Point({
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
    Point memory initialLastPoint =
      Point({bias: 0, slope: 0, ts: lastPoint.ts, blk: lastPoint.blk});
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
      int128 biasDelta =
        lastPoint.slope *
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
    LockedBalance memory newLocked =
      LockedBalance({
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
    contractNotStopped
    isWhitelisted(msg.sender)
  {
    uint256 unlock_time = _floorToWeek(_unlockTime); // Locktime is rounded down to weeks
    LockedBalance memory locked_ =
      LockedBalance({
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
    contractNotStopped
    isWhitelisted(msg.sender)
  {
    LockedBalance memory locked_ =
      LockedBalance({
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
    contractNotStopped
    isWhitelisted(msg.sender)
  {
    LockedBalance memory locked_ =
      LockedBalance({
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
  function withdraw() external override {
    _withdraw(msg.sender);
  }

  /**
   * @dev Withdraws a given users stake, providing the lockup has finished
   * @param _addr User for which to withdraw
   */
  function _withdraw(address _addr) internal nonReentrant {
    LockedBalance memory oldLock =
      LockedBalance({
        end: locked[_addr].end,
        shares: locked[_addr].shares,
        amount: locked[_addr].amount
      });
    require(block.timestamp >= oldLock.end, "The lock didn't expire");
    require(oldLock.amount > 0, "Must have something to withdraw");

    uint256 shares = SafeCast.toUint256(oldLock.shares);

    LockedBalance memory currentLock =
      LockedBalance({end: 0, shares: 0, amount: 0});
    locked[_addr] = currentLock;

    // oldLocked can have either expired <= timestamp or zero end
    // currentLock has only 0 end
    // Both can have >= 0 amount
    _checkpoint(_addr, oldLock, currentLock);

    uint256 value =
      shares.mul(stakingToken.balanceOf(address(this))).div(totalShares);
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
  function delegate(address delegatee) public {
    return _delegate(msg.sender, delegatee);
  }

  /**
   * @notice Delegates votes from signatory to `delegatee`
   * @param delegatee The address to delegate votes to
   * @param nonce The contract state required to match the signature
   * @param expiry The time at which to expire the signature
   * @param v The recovery byte of the signature
   * @param r Half of the ECDSA signature pair
   * @param s Half of the ECDSA signature pair
   */
  function delegateBySig(
    address delegatee,
    uint256 nonce,
    uint256 expiry,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) public {
    bytes32 domainSeparator =
      keccak256(
        abi.encode(
          DOMAIN_TYPEHASH,
          keccak256(bytes(name)),
          getChainId(),
          address(this)
        )
      );
    bytes32 structHash =
      keccak256(abi.encode(DELEGATION_TYPEHASH, delegatee, nonce, expiry));
    bytes32 digest =
      keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    address signatory = ecrecover(digest, v, r, s);
    require(signatory != address(0), "sRBN::delegateBySig: invalid signature");
    require(nonce == nonces[signatory]++, "sRBN::delegateBySig: invalid nonce");
    require(
      block.timestamp <= expiry,
      "sRBN::delegateBySig: signature expired"
    );
    return _delegate(signatory, delegatee);
  }

  function _delegate(address delegator, address delegatee) internal {
    require(
      delegates[delegator] == delegatee || delegates[delegator] == address(0),
      "Different delegator"
    );
    uint96 delegatorBalance = getCurrentVotes(delegator);
    uint96 boostExpiry = locked[delegator].end;
    if (delegates[delegator] == address(0)) {
      delegates[delegator] = delegatee;
    }

    emit DelegateSet(delegator, delegatee, delegatorBalance, boostExpiry);

    _moveDelegates(delegator, delegatee, boostExpiry, delegatorBalance);
  }

  function _moveDelegates(
    address _delegator,
    address _receiver,
    uint256 _expireTime,
    uint256 _amt
  ) internal {
    require(_receiver != address(0), "Receiver is address(0)!");

    uint32 nCheckpointsDelegator = numCheckpoints[_delegator];
    uint32 nCheckpointsReceiver = numCheckpoints[_receiver];

    uint128 nextExpiry =
      nCheckpointsDelegator > 0
        ? _boost[_delegator][nCheckpointsDelegator - 1].nextExpiry
        : 0;
    uint256 expireTime = (_expireTime / 1 weeks) * 1 weeks;

    if (nextExpiry == 0) {
      nextExpiry = type(uint128).max;
    }

    require(
      block.timestamp < nextExpiry,
      "Delegated a now expired boost in the past. Please cancel"
    );

    // delegated slope and bias
    uint256 delegatedBias =
      nCheckpointsDelegator > 0
        ? _boost[_delegator][nCheckpointsDelegator - 1].delegatedBias
        : 0;
    int128 delegatedSlope =
      nCheckpointsDelegator > 0
        ? _boost[_delegator][nCheckpointsDelegator - 1].delegatedSlope
        : int128(0);

    // delegated boost will be positive, if any of circulating boosts are negative
    // we have already reverted
    int256 delegatedBoost =
      delegatedSlope * int256(block.timestamp) + int256(delegatedBias);
    int256 y = int256(_amt) - delegatedBoost;
    require(y > 0, "No boost");

    (int128 slope, uint256 bias) =
      _calcBiasSlope(int256(block.timestamp), y, int256(expireTime));
    require(slope < 0, "invalid slope");

    uint32 blockNumber =
      safe32(
        block.number,
        "sRBN::_writeCheckpoint: block number exceeds 32 bits"
      );

    // increase the number of expiries for the user
    if (expireTime < nextExpiry) {
      nextExpiry = uint128(expireTime);
    }

    _writeCheckpoint(
      _delegator,
      _receiver,
      nCheckpointsDelegator,
      nCheckpointsReceiver,
      slope,
      bias,
      nextExpiry,
      blockNumber
    );
  }

  function _writeCheckpoint(
    address _delegator,
    address _receiver,
    uint32 _nCheckpointsDelegator,
    uint32 _nCheckpointsReceiver,
    int128 _slope,
    uint256 _bias,
    uint128 _nextExpiry,
    uint32 _blk
  ) internal {
    if (
      _nCheckpointsDelegator > 0 &&
      _boost[_delegator][_nCheckpointsDelegator - 1].fromBlock == _blk
    ) {
      _boost[_delegator][_nCheckpointsDelegator - 1].delegatedBias += _bias;
      _boost[_delegator][_nCheckpointsDelegator - 1].delegatedSlope += _slope;
      _boost[_delegator][_nCheckpointsDelegator - 1].nextExpiry = _nextExpiry;
    } else {
      uint256 delegatedBias =
        _nCheckpointsDelegator > 0
          ? _boost[_delegator][_nCheckpointsDelegator - 1].delegatedBias
          : 0;
      int128 delegatedSlope =
        _nCheckpointsDelegator > 0
          ? _boost[_delegator][_nCheckpointsDelegator - 1].delegatedSlope
          : int128(0);
      uint256 receivedBias =
        _nCheckpointsDelegator > 0
          ? _boost[_delegator][_nCheckpointsDelegator - 1].receivedBias
          : 0;
      int128 receivedSlope =
        _nCheckpointsDelegator > 0
          ? _boost[_delegator][_nCheckpointsDelegator - 1].receivedSlope
          : int128(0);
      _boost[_delegator][_nCheckpointsDelegator] = Boost(
        delegatedBias + _bias,
        delegatedSlope + _slope,
        receivedBias,
        receivedSlope,
        _nextExpiry,
        _blk
      );
      numCheckpoints[_delegator] = _nCheckpointsDelegator + 1;
    }

    if (
      _nCheckpointsReceiver > 0 &&
      _boost[_receiver][_nCheckpointsReceiver - 1].fromBlock == _blk
    ) {
      _boost[_receiver][_nCheckpointsReceiver - 1].receivedBias += _bias;
      _boost[_receiver][_nCheckpointsReceiver - 1].receivedSlope += _slope;
      _boost[_receiver][_nCheckpointsReceiver - 1].nextExpiry = _nextExpiry;
    } else {
      uint256 delegatorBias =
        _nCheckpointsReceiver > 0
          ? _boost[_receiver][_nCheckpointsReceiver - 1].delegatedBias
          : 0;
      int128 delegatorSlope =
        _nCheckpointsReceiver > 0
          ? _boost[_receiver][_nCheckpointsReceiver - 1].delegatedSlope
          : int128(0);
      uint256 receivedBias =
        _nCheckpointsReceiver > 0
          ? _boost[_receiver][_nCheckpointsReceiver - 1].receivedBias
          : 0;
      int128 receivedSlope =
        _nCheckpointsReceiver > 0
          ? _boost[_receiver][_nCheckpointsReceiver - 1].receivedSlope
          : int128(0);
      _boost[_receiver][_nCheckpointsReceiver] = Boost(
        delegatorBias,
        delegatorSlope,
        receivedBias + _bias,
        receivedSlope + _slope,
        _nextExpiry,
        _blk
      );
      numCheckpoints[_receiver] = _nCheckpointsReceiver + 1;
    }
  }

  function cancelDelegate() external {
    address _receiver = delegates[msg.sender];

    require(_receiver != address(0), "No delegation to cancel!");

    uint32 nCheckpointsDelegator = numCheckpoints[msg.sender];
    uint32 nCheckpointsReceiver = numCheckpoints[_receiver];

    // Since in order to cancel you must have set a delegation
    uint128 expireTime =
      _boost[msg.sender][nCheckpointsDelegator - 1].nextExpiry;

    if (expireTime == 0) {
      return;
    }

    uint32 blockNumber =
      safe32(
        block.number,
        "sRBN::_writeCheckpoint: block number exceeds 32 bits"
      );

    // Since in order to cancel you must have set a delegation,
    // nCheckpointsDelegator and nCheckpointsReceiver must both be > 0 at this point

    uint256 delegatedBias =
      _boost[msg.sender][nCheckpointsDelegator - 1].delegatedBias;
    int128 delegatedSlope =
      _boost[msg.sender][nCheckpointsDelegator - 1].delegatedSlope;

    if (_boost[_receiver][nCheckpointsReceiver - 1].fromBlock == blockNumber) {
      _boost[_receiver][nCheckpointsReceiver - 1].receivedBias -= delegatedBias;
      _boost[_receiver][nCheckpointsReceiver - 1]
        .receivedSlope -= delegatedSlope;
    } else {
      _boost[_receiver][nCheckpointsReceiver] = _boost[_receiver][
        nCheckpointsReceiver - 1
      ];
      _boost[_receiver][nCheckpointsReceiver].receivedBias -= delegatedBias;
      _boost[_receiver][nCheckpointsReceiver].receivedSlope -= delegatedSlope;
      _boost[_receiver][nCheckpointsReceiver].fromBlock = blockNumber;
      numCheckpoints[_receiver] = nCheckpointsReceiver + 1;
    }

    if (
      _boost[msg.sender][nCheckpointsDelegator - 1].fromBlock == blockNumber
    ) {
      _boost[msg.sender][nCheckpointsDelegator - 1].delegatedBias = 0;
      _boost[msg.sender][nCheckpointsDelegator - 1].delegatedSlope = 0;
      _boost[msg.sender][nCheckpointsDelegator - 1].nextExpiry = 0;
    } else {
      uint256 receivedBias =
        _boost[msg.sender][nCheckpointsDelegator - 1].receivedBias;
      int128 receivedSlope =
        _boost[msg.sender][nCheckpointsDelegator - 1].receivedSlope;
      _boost[msg.sender][nCheckpointsDelegator] = Boost(
        0,
        0,
        receivedBias,
        receivedSlope,
        0,
        blockNumber
      );
      numCheckpoints[msg.sender] = nCheckpointsDelegator + 1;
    }

    delegates[msg.sender] = address(0);

    uint256 amtDelegationRemoved =
      uint256(delegatedSlope * int256(block.timestamp) + int256(delegatedBias));

    emit DelegateRemoved(msg.sender, _receiver, amtDelegationRemoved);
  }

  /***************************************
                    GETTERS
    ****************************************/

  /** @dev Floors a timestamp to the nearest weekly increment */
  function _floorToWeek(uint256 _t) internal pure returns (uint256) {
    return (_t / WEEK) * WEEK;
  }

  /**
   * @dev Uses binarysearch to find the most recent point history preceeding block
   * @param _block Find the most recent point history before this block
   * @param _maxEpoch Do not search pointHistories past this index
   */
  function _findBlockEpoch(uint256 _block, uint256 _maxEpoch)
    internal
    view
    returns (uint256)
  {
    // Binary search
    uint256 min = 0;
    uint256 max = _maxEpoch;
    // Will be always enough for 128-bit numbers
    for (uint256 i = 0; i < 128; i++) {
      if (min >= max) break;
      uint256 mid = (min + max + 1) / 2;
      if (pointHistory[mid].blk <= _block) {
        min = mid;
      } else {
        max = mid - 1;
      }
    }
    return min;
  }

  /**
   * @dev Uses binarysearch to find the most recent user point history preceeding block
   * @param _addr User for which to search
   * @param _block Find the most recent point history before this block
   */
  function _findUserBlockEpoch(address _addr, uint256 _block)
    internal
    view
    returns (uint256)
  {
    uint256 min = 0;
    uint256 max = userPointEpoch[_addr];
    for (uint256 i = 0; i < 128; i++) {
      if (min >= max) {
        break;
      }
      uint256 mid = (min + max + 1) / 2;
      if (userPointHistory[_addr][mid].blk <= _block) {
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
   * @param _nextExpiry Next expiry of the delegation
   */
  function _findDelegationBlockEpoch(
    address _addr,
    uint256 _block,
    uint128 _nextExpiry
  )
    internal
    view
    returns (
      uint256,
      int128,
      uint256,
      int128
    )
  {
    require(_block < block.number, "sRBN::getPriorVotes: not yet determined");

    uint32 nCheckpoints = numCheckpoints[_addr];
    if (nCheckpoints == 0 || _nextExpiry == 0) {
      return (0, 0, 0, 0);
    }

    Boost memory cp;

    // First check most recent balance
    if (_boost[_addr][nCheckpoints - 1].fromBlock <= _block) {
      cp = _boost[_addr][nCheckpoints - 1];
      return (
        cp.delegatedBias,
        cp.delegatedSlope,
        cp.receivedBias,
        cp.receivedSlope
      );
    }

    // Next check implicit zero balance
    if (_boost[_addr][0].fromBlock > _block) {
      return (0, 0, 0, 0);
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
          cp.receivedSlope
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
      cp.receivedSlope
    );
  }

  function _calcBiasSlope(
    int256 _x,
    int256 _y,
    int256 _expireTime
  ) internal pure returns (int128 slope, uint256 bias) {
    // SLOPE: (y2 - y1) / (x2 - x1)
    // BIAS: y = mx + b -> y - mx = b
    slope = SafeCast.toInt128(-_y / (_expireTime - _x));
    bias = uint256(_y - slope * _x);
  }

  function calcBoostBiasSlope(address _delegator)
    external
    view
    returns (int128, uint256)
  {
    if (delegates[_delegator] == address(0)) {
      return (0, 0);
    }

    uint32 nCheckpointsDelegator = numCheckpoints[_delegator];
    uint128 expireTime =
      _boost[msg.sender][nCheckpointsDelegator - 1].nextExpiry;

    if (expireTime == 0) {
      return (0, 0);
    }

    uint256 delegatedBias =
      _boost[_delegator][nCheckpointsDelegator - 1].delegatedBias;
    int128 delegatedSlope =
      _boost[_delegator][nCheckpointsDelegator - 1].delegatedSlope;

    // delegated boost will be positive, if any of circulating boosts are negative
    // we have already reverted
    int256 delegatedBoost =
      delegatedSlope * int256(block.timestamp) + int256(delegatedBias);
    int256 y = int256(uint256(getCurrentVotes(_delegator))) - delegatedBoost;
    require(y > 0, "No boost");

    (int128 slope, uint256 bias) =
      _calcBiasSlope(int256(block.timestamp), y, int256(block.timestamp));
    require(slope < 0, "invalid slope");

    return (slope, bias);
  }

  function checkBoost(address _addr, bool _isDelegator)
    external
    view
    returns (uint256)
  {
    if (delegates[_addr] == address(0) && _isDelegator) {
      return 0;
    }

    uint32 nCheckpoints = numCheckpoints[_addr];

    uint128 expireTime = _boost[msg.sender][nCheckpoints - 1].nextExpiry;

    if (expireTime == 0 && _isDelegator) {
      return 0;
    }

    uint256 bias =
      _isDelegator
        ? _boost[_addr][nCheckpoints - 1].delegatedBias
        : _boost[_addr][nCheckpoints - 1].receivedBias;
    int128 slope =
      _isDelegator
        ? _boost[_addr][nCheckpoints - 1].delegatedSlope
        : _boost[_addr][nCheckpoints - 1].receivedSlope;

    int256 balance = slope * int256(block.timestamp) + int256(bias);

    if (_isDelegator) {
      return uint256(StableMath.abs(balance));
    } else {
      return balance > 0 ? uint256(balance) : 0;
    }
  }

  /**
   * @dev Gets curent user voting weight (aka effectiveStake)
   * @param _owner User for which to return the balance
   * @return uint96 Balance of user
   */
  function getCurrentVotes(address _owner) public view returns (uint96) {
    uint256 epoch = userPointEpoch[_owner];
    if (epoch == 0) {
      return 0;
    }
    Point memory lastPoint = userPointHistory[_owner][epoch];
    lastPoint.bias =
      lastPoint.bias -
      (lastPoint.slope *
        SafeCast.toInt128(int256(block.timestamp - lastPoint.ts)));
    if (lastPoint.bias < 0) {
      lastPoint.bias = 0;
    }

    return StableMath.toUint96(SafeCast.toUint256(lastPoint.bias));
  }

  function _balanceOfAt(address _owner, uint256 _blockNumber)
    public
    view
    returns (uint96)
  {
    require(_blockNumber <= block.number, "Must pass block number in the past");

    // Get most recent user Point to block
    uint256 userEpoch = _findUserBlockEpoch(_owner, _blockNumber);
    if (userEpoch == 0) {
      return 0;
    }
    Point memory upoint = userPointHistory[_owner][userEpoch];

    // Get most recent global Point to block
    uint256 maxEpoch = globalEpoch;
    uint256 epoch = _findBlockEpoch(_blockNumber, maxEpoch);
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
      return StableMath.toUint96(SafeCast.toUint256(upoint.bias));
    } else {
      return 0;
    }
  }

  /**
   * @dev Gets a users votingWeight at a given blockNumber
   * @dev Block number must be a finalized block or else this function will revert to prevent misinformation.
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
    uint32 nCheckpoints = numCheckpoints[_owner];
    uint128 nextExpiry =
      nCheckpoints > 0 ? _boost[_owner][nCheckpoints - 1].nextExpiry : 0;
    if (nextExpiry != 0 && nextExpiry < block.timestamp) {
      // if the account has a negative boost in circulation
      // we over penalize by setting their adjusted balance to 0
      // this is because we don't want to iterate to find the real
      // value
      return 0;
    }

    uint96 adjustedBalance = _balanceOfAt(_owner, _blockNumber);

    (
      uint256 delegatedBias,
      int128 delegatedSlope,
      uint256 receivedBias,
      int128 receivedSlope
    ) = _findDelegationBlockEpoch(_owner, _blockNumber, nextExpiry);

    if (delegatedBias != 0) {
      // we take the absolute value, since delegated boost can be negative
      // if any outstanding negative boosts are in circulation
      // this can inflate the vecrv balance of a user
      // taking the absolute value has the effect that it costs
      // a user to negatively impact another's vecrv balance
      adjustedBalance -= uint96(
        uint256(
          StableMath.abs(
            delegatedSlope * int256(block.timestamp) + int256(delegatedBias)
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
      int256 receivedBal =
        receivedSlope * int256(block.timestamp) + int256(receivedBias);
      adjustedBalance += uint96(receivedBal > 0 ? uint256(receivedBal) : 0);
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
   * @dev Calculates total supply of votingWeight at a given blockNumber
   * @param _blockNumber Block number at which to calculate total supply
   * @return totalSupply of voting token weight at the given blockNumber
   */
  function totalSupplyAt(uint256 _blockNumber) public view returns (uint256) {
    require(_blockNumber <= block.number, "Must pass block number in the past");

    uint256 epoch = globalEpoch;
    uint256 targetEpoch = _findBlockEpoch(_blockNumber, epoch);

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

  function getChainId() internal view returns (uint256) {
    uint256 chainId;
    assembly {
      chainId := chainid()
    }
    return chainId;
  }

  function safe32(uint256 n, string memory errorMessage)
    internal
    pure
    returns (uint32)
  {
    require(n < 2**32, errorMessage);
    return uint32(n);
  }
}
