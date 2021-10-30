pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "./SafeMath.sol";
import "hardhat/console.sol";

contract StakedRibbon {
  /// @notice EIP-20 token name for this token
  string public constant name = "Staked Ribbon";

  /// @notice EIP-20 token symbol for this token
  string public constant symbol = "sRBN";

  /// @notice EIP-20 token decimals for this token
  uint8 public constant decimals = 18;

  /// @notice Total number of tokens in circulation
  uint256 public totalSupply;

  /// @notice Address which may mint new tokens
  address public minter;

  /// @notice Address with transfer toggle ability
  address public admin;

  /// @notice Transfers allow
  bool public transfersAllowed;

  /// @notice Allowance amounts on behalf of others
  mapping(address => mapping(address => uint96)) internal allowances;

  /// @notice Official record of token balances for each account
  mapping(address => uint96) internal balances;

  /// @notice A record of each accounts delegate
  mapping(address => address) public delegates;

  /// @notice A checkpoint for marking number of votes from a given block
  struct Checkpoint {
    uint32 fromBlock;
    uint96 votes;
  }

  /// @notice A record of votes checkpoints for each account, by index
  mapping(address => mapping(uint32 => Checkpoint)) public checkpoints;

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

  /// @notice An event thats emitted when the minter address is changed
  event MinterChanged(address minter, address newMinter);

  /// @dev Emitted when transfer toggle is switched
  event TransfersAllowed(bool transfersAllowed);

  /// @notice An event thats emitted when an account changes its delegate
  event DelegateChanged(
    address indexed delegator,
    address indexed fromDelegate,
    address indexed toDelegate
  );

  /// @notice An event thats emitted when a delegate account's vote balance changes
  event DelegateVotesChanged(
    address indexed delegate,
    uint256 previousBalance,
    uint256 newBalance
  );

  /// @notice The standard EIP-20 transfer event
  event Transfer(address indexed from, address indexed to, uint256 amount);

  /// @notice The standard EIP-20 approval event
  event Approval(
    address indexed owner,
    address indexed spender,
    uint256 amount
  );

  /**
   * @notice Construct a new Uni token
   * @param minter_ The account with minting ability
   * @param admin_ The account with transfer toggle ability
   * @param transfersAllowed_ True if transfers are allowed, false otherwise
   */
  constructor(
    address minter_,
    address admin_,
    bool transfersAllowed_
  ) public {
    minter = minter_;
    admin = admin_;
    transfersAllowed = transfersAllowed_;
    emit MinterChanged(address(0), minter);
  }

  /**
   * @notice Change the minter address
   * @param minter_ The address of the new minter
   */
  function setMinter(address minter_) external {
    require(
      msg.sender == minter,
      "sRBN::setMinter: only the minter can change the minter address"
    );
    emit MinterChanged(minter, minter_);
    minter = minter_;
  }

  /// @dev Toggles transfer allowed flag.
  ///
  /// This function reverts if the caller does not have the admin role.
  function setTransfersAllowed(bool _transfersAllowed) external {
    require(
      msg.sender == admin,
      "sRBN::setTransfersAllowed: only the admin can change the transfer toggle"
    );
    transfersAllowed = _transfersAllowed;
    emit TransfersAllowed(transfersAllowed);
  }

  /**
   * @notice Mint new tokens
   * @param dst The address of the destination account
   * @param rawAmount The number of tokens to be minted
   */
  function mint(address dst, uint256 rawAmount) external {
    require(msg.sender == minter, "sRBN::mint: only the minter can mint");
    require(
      dst != address(0),
      "sRBN::mint: cannot transfer to the zero address"
    );

    // mint the amount
    uint96 amount = safe96(rawAmount, "sRBN::mint: amount exceeds 96 bits");
    totalSupply = safe96(
      SafeMath.add(totalSupply, amount),
      "sRBN::mint: totalSupply exceeds 96 bits"
    );

    // transfer the amount to the recipient
    balances[dst] = add96(
      balances[dst],
      amount,
      "sRBN::mint: transfer amount overflows"
    );
    emit Transfer(address(0), dst, amount);

    // move delegates
    _moveDelegates(address(0), delegates[dst], amount);
  }

  /**
   * @notice Burns tokens
   * @param src The address of the destination account
   * @param rawAmount The number of tokens to be minted
   */
  function _burn(address src, uint256 rawAmount) internal {
    require(msg.sender == minter, "sRBN::burn: only the minter can burn");
    require(
      src != address(0),
      "sRBN::burn: cannot transfer to the zero address"
    );

    // mint the amount
    uint96 amount = safe96(rawAmount, "sRBN::burn: amount exceeds 96 bits");
    // totalSupply cannot underflow
    totalSupply = safe96(
      totalSupply - amount,
      "sRBN::burn: totalSupply exceeds 96 bits"
    );

    // transfer the amount to the recipient
    balances[src] = sub96(
      balances[src],
      amount,
      "sRBN::burn: transfer amount overflows"
    );
    emit Transfer(src, address(0), amount);

    // move delegates
    _moveDelegates(delegates[src], address(0), amount);
  }

  /**
   * @dev Destroys `amount` tokens from the caller.
   *
   * See {ERC20-_burn}.
   */
  function burn(uint256 amount) external {
    _burn(msg.sender, amount);
  }

  /**
   * @dev Destroys `amount` tokens from `account`, deducting from the caller's
   * allowance.
   *
   * See {ERC20-_burn} and {ERC20-allowance}.
   *
   * Requirements:
   *
   * - the caller must have allowance for ``accounts``'s tokens of at least
   * `amount`.
   */
  function burnFrom(address account, uint256 rawAmount) external {
    uint96 amount = safe96(rawAmount, "sRBN::burn: amount exceeds 96 bits");

    uint256 currentAllowance = allowances[account][msg.sender];
    require(
      currentAllowance >= amount,
      "sRBN::burnFrom: burn amount exceeds allowance"
    );

    allowances[account][msg.sender] = sub96(
      allowances[account][msg.sender],
      amount,
      "sRBN::burnFrom: burn amount exceeds allowance"
    );
    _burn(account, amount);
  }

  /**
   * @notice Get the number of tokens `spender` is approved to spend on behalf of `account`
   * @param account The address of the account holding the funds
   * @param spender The address of the account spending the funds
   * @return The number of tokens approved
   */
  function allowance(address account, address spender)
    external
    view
    returns (uint256)
  {
    return allowances[account][spender];
  }

  /**
   * @notice Approve `spender` to transfer up to `amount` from `src`
   * @dev This will overwrite the approval amount for `spender`
   *  and is subject to issues noted [here](https://eips.ethereum.org/EIPS/eip-20#approve)
   * @param spender The address of the account which may transfer tokens
   * @param rawAmount The number of tokens that are approved (2^256-1 means infinite)
   * @return Whether or not the approval succeeded
   */
  function approve(address spender, uint256 rawAmount) external returns (bool) {
    uint96 amount;
    if (rawAmount == uint256(-1)) {
      amount = uint96(-1);
    } else {
      amount = safe96(rawAmount, "sRBN::approve: amount exceeds 96 bits");
    }

    allowances[msg.sender][spender] = amount;

    emit Approval(msg.sender, spender, amount);
    return true;
  }

  /**
   * @notice Triggers an approval from owner to spends
   * @param owner The address to approve from
   * @param spender The address to be approved
   * @param rawAmount The number of tokens that are approved (2^256-1 means infinite)
   * @param deadline The time at which to expire the signature
   * @param v The recovery byte of the signature
   * @param r Half of the ECDSA signature pair
   * @param s Half of the ECDSA signature pair
   */
  function permit(
    address owner,
    address spender,
    uint256 rawAmount,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external {
    uint96 amount;
    if (rawAmount == uint256(-1)) {
      amount = uint96(-1);
    } else {
      amount = safe96(rawAmount, "sRBN::permit: amount exceeds 96 bits");
    }

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
      keccak256(
        abi.encode(
          PERMIT_TYPEHASH,
          owner,
          spender,
          rawAmount,
          nonces[owner]++,
          deadline
        )
      );
    bytes32 digest =
      keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    address signatory = ecrecover(digest, v, r, s);
    require(signatory != address(0), "sRBN::permit: invalid signature");
    require(signatory == owner, "sRBN::permit: unauthorized");
    require(now <= deadline, "sRBN::permit: signature expired");

    allowances[owner][spender] = amount;

    emit Approval(owner, spender, amount);
  }

  function toHex16(bytes16 data) internal pure returns (bytes32 result) {
    result =
      (bytes32(data) &
        0xFFFFFFFFFFFFFFFF000000000000000000000000000000000000000000000000) |
      ((bytes32(data) &
        0x0000000000000000FFFFFFFFFFFFFFFF00000000000000000000000000000000) >>
        64);
    result =
      (result &
        0xFFFFFFFF000000000000000000000000FFFFFFFF000000000000000000000000) |
      ((result &
        0x00000000FFFFFFFF000000000000000000000000FFFFFFFF0000000000000000) >>
        32);
    result =
      (result &
        0xFFFF000000000000FFFF000000000000FFFF000000000000FFFF000000000000) |
      ((result &
        0x0000FFFF000000000000FFFF000000000000FFFF000000000000FFFF00000000) >>
        16);
    result =
      (result &
        0xFF000000FF000000FF000000FF000000FF000000FF000000FF000000FF000000) |
      ((result &
        0x00FF000000FF000000FF000000FF000000FF000000FF000000FF000000FF0000) >>
        8);
    result =
      ((result &
        0xF000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F000) >>
        4) |
      ((result &
        0x0F000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F00) >>
        8);
    result = bytes32(
      0x3030303030303030303030303030303030303030303030303030303030303030 +
        uint256(result) +
        (((uint256(result) +
          0x0606060606060606060606060606060606060606060606060606060606060606) >>
          4) &
          0x0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F) *
        7
    );
  }

  function bytes32ToString(bytes32 data) public pure returns (string memory) {
    return
      string(
        abi.encodePacked(
          "0x",
          toHex16(bytes16(data)),
          toHex16(bytes16(data << 128))
        )
      );
  }

  /**
   * @notice Get the number of tokens held by the `account`
   * @param account The address of the account to get the balance of
   * @return The number of tokens held
   */
  function balanceOf(address account) external view returns (uint256) {
    return balances[account];
  }

  /**
   * @notice Transfer `amount` tokens from `msg.sender` to `dst`
   * @param dst The address of the destination account
   * @param rawAmount The number of tokens to transfer
   * @return Whether or not the transfer succeeded
   */
  function transfer(address dst, uint256 rawAmount) external returns (bool) {
    uint96 amount = safe96(rawAmount, "sRBN::transfer: amount exceeds 96 bits");
    _transferTokens(msg.sender, dst, amount);
    return true;
  }

  /**
   * @notice Transfer `amount` tokens from `src` to `dst`
   * @param src The address of the source account
   * @param dst The address of the destination account
   * @param rawAmount The number of tokens to transfer
   * @return Whether or not the transfer succeeded
   */
  function transferFrom(
    address src,
    address dst,
    uint256 rawAmount
  ) external returns (bool) {
    address spender = msg.sender;
    uint96 spenderAllowance = allowances[src][spender];
    uint96 amount = safe96(rawAmount, "sRBN::approve: amount exceeds 96 bits");

    if (spender != src && spenderAllowance != uint96(-1)) {
      uint96 newAllowance =
        sub96(
          spenderAllowance,
          amount,
          "sRBN::transferFrom: transfer amount exceeds spender allowance"
        );
      allowances[src][spender] = newAllowance;

      emit Approval(src, spender, newAllowance);
    }

    _transferTokens(src, dst, amount);
    return true;
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
    require(now <= expiry, "sRBN::delegateBySig: signature expired");
    return _delegate(signatory, delegatee);
  }

  /**
   * @notice Gets the current votes balance for `account`
   * @param account The address to get votes balance
   * @return The number of current votes for `account`
   */
  function getCurrentVotes(address account) external view returns (uint96) {
    uint32 nCheckpoints = numCheckpoints[account];
    return nCheckpoints > 0 ? checkpoints[account][nCheckpoints - 1].votes : 0;
  }

  /**
   * @notice Determine the prior number of votes for an account as of a block number
   * @dev Block number must be a finalized block or else this function will revert to prevent misinformation.
   * @param account The address of the account to check
   * @param blockNumber The block number to get the vote balance at
   * @return The number of votes the account had as of the given block
   */
  function getPriorVotes(address account, uint256 blockNumber)
    public
    view
    returns (uint96)
  {
    require(
      blockNumber < block.number,
      "sRBN::getPriorVotes: not yet determined"
    );

    uint32 nCheckpoints = numCheckpoints[account];
    if (nCheckpoints == 0) {
      return 0;
    }

    // First check most recent balance
    if (checkpoints[account][nCheckpoints - 1].fromBlock <= blockNumber) {
      return checkpoints[account][nCheckpoints - 1].votes;
    }

    // Next check implicit zero balance
    if (checkpoints[account][0].fromBlock > blockNumber) {
      return 0;
    }

    uint32 lower = 0;
    uint32 upper = nCheckpoints - 1;
    while (upper > lower) {
      uint32 center = upper - (upper - lower) / 2; // ceil, avoiding overflow
      Checkpoint memory cp = checkpoints[account][center];
      if (cp.fromBlock == blockNumber) {
        return cp.votes;
      } else if (cp.fromBlock < blockNumber) {
        lower = center;
      } else {
        upper = center - 1;
      }
    }
    return checkpoints[account][lower].votes;
  }

  function _delegate(address delegator, address delegatee) internal {
    address currentDelegate = delegates[delegator];
    uint96 delegatorBalance = balances[delegator];
    delegates[delegator] = delegatee;

    emit DelegateChanged(delegator, currentDelegate, delegatee);

    _moveDelegates(currentDelegate, delegatee, delegatorBalance);
  }

  function _transferTokens(
    address src,
    address dst,
    uint96 amount
  ) internal {
    require(
      src != address(0),
      "sRBN::_transferTokens: cannot transfer from the zero address"
    );
    require(
      dst != address(0),
      "sRBN::_transferTokens: cannot transfer to the zero address"
    );
    require(transfersAllowed, "sRBN::_transferTokens: transfers not allowed");

    balances[src] = sub96(
      balances[src],
      amount,
      "sRBN::_transferTokens: transfer amount exceeds balance"
    );
    balances[dst] = add96(
      balances[dst],
      amount,
      "sRBN::_transferTokens: transfer amount overflows"
    );
    emit Transfer(src, dst, amount);

    _moveDelegates(delegates[src], delegates[dst], amount);
  }

  function _moveDelegates(
    address srcRep,
    address dstRep,
    uint96 amount
  ) internal {
    if (srcRep != dstRep && amount > 0) {
      if (srcRep != address(0)) {
        uint32 srcRepNum = numCheckpoints[srcRep];
        uint96 srcRepOld =
          srcRepNum > 0 ? checkpoints[srcRep][srcRepNum - 1].votes : 0;
        uint96 srcRepNew =
          sub96(srcRepOld, amount, "sRBN::_moveVotes: vote amount underflows");
        _writeCheckpoint(srcRep, srcRepNum, srcRepOld, srcRepNew);
      }

      if (dstRep != address(0)) {
        uint32 dstRepNum = numCheckpoints[dstRep];
        uint96 dstRepOld =
          dstRepNum > 0 ? checkpoints[dstRep][dstRepNum - 1].votes : 0;
        uint96 dstRepNew =
          add96(dstRepOld, amount, "sRBN::_moveVotes: vote amount overflows");
        _writeCheckpoint(dstRep, dstRepNum, dstRepOld, dstRepNew);
      }
    }
  }

  function _writeCheckpoint(
    address delegatee,
    uint32 nCheckpoints,
    uint96 oldVotes,
    uint96 newVotes
  ) internal {
    uint32 blockNumber =
      safe32(
        block.number,
        "sRBN::_writeCheckpoint: block number exceeds 32 bits"
      );

    if (
      nCheckpoints > 0 &&
      checkpoints[delegatee][nCheckpoints - 1].fromBlock == blockNumber
    ) {
      checkpoints[delegatee][nCheckpoints - 1].votes = newVotes;
    } else {
      checkpoints[delegatee][nCheckpoints] = Checkpoint(blockNumber, newVotes);
      numCheckpoints[delegatee] = nCheckpoints + 1;
    }

    emit DelegateVotesChanged(delegatee, oldVotes, newVotes);
  }

  function safe32(uint256 n, string memory errorMessage)
    internal
    pure
    returns (uint32)
  {
    require(n < 2**32, errorMessage);
    return uint32(n);
  }

  function safe96(uint256 n, string memory errorMessage)
    internal
    pure
    returns (uint96)
  {
    require(n < 2**96, errorMessage);
    return uint96(n);
  }

  function add96(
    uint96 a,
    uint96 b,
    string memory errorMessage
  ) internal pure returns (uint96) {
    uint96 c = a + b;
    require(c >= a, errorMessage);
    return c;
  }

  function sub96(
    uint96 a,
    uint96 b,
    string memory errorMessage
  ) internal pure returns (uint96) {
    require(b <= a, errorMessage);
    return a - b;
  }

  function getChainId() internal pure returns (uint256) {
    uint256 chainId;
    assembly {
      chainId := chainid()
    }
    return chainId;
  }
}
