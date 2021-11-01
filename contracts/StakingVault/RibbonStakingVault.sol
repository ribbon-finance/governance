// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
  SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
  ReentrancyGuardUpgradeable
} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {
  OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
  RibbonStakingVaultStorage
} from "../storage/RibbonStakingVaultStorage.sol";
import {Vault} from "../libraries/Vault.sol";
import {VaultLifecycle} from "../libraries/VaultLifecycle.sol";
import {ShareMath} from "../libraries/ShareMath.sol";
import {IWETH} from "../interfaces/IWETH.sol";
import {ISRBN} from "../interfaces/ISRBN.sol";

/**
 * UPGRADEABILITY: Since we use the upgradeable proxy pattern, we must observe
 * the inheritance chain closely.
 * Any changes/appends in storage variable needs to happen in RibbonThetaVaultStorage.
 * RibbonThetaVault should not inherit from any other contract aside from RibbonVault, RibbonThetaVaultStorage
 */
contract RibbonStakingVault is
  ReentrancyGuardUpgradeable,
  OwnableUpgradeable,
  RibbonStakingVaultStorage
{
  using SafeERC20 for IERC20;
  using SafeMath for uint256;
  using ShareMath for Vault.DepositReceipt;

  /************************************************
   *  IMMUTABLES & CONSTANTS
   ***********************************************/

  /// @notice RBN 0x6123b0049f904d730db3c36a31167d9d4121fa6b
  address public immutable RBN;
  /// @notice sRBN
  ISRBN public immutable sRBN;

  /************************************************
   *  NON UPGRADEABLE STORAGE
   ***********************************************/

  /// @notice Stores the user's pending deposit for the round
  mapping(address => Vault.DepositReceipt) public depositReceipts;

  /// @notice On every round's close, the pricePerShare value of sRBN token is stored
  /// This is used to determine the number of shares to be returned
  /// to a user with their DepositReceipt.depositAmount
  mapping(uint256 => uint256) public roundPricePerShare;

  /// @notice Stores pending user withdrawals
  mapping(address => Vault.Withdrawal) public withdrawals;

  /// @notice Vault's parameters like cap, decimals
  Vault.VaultParams public vaultParams;

  /// @notice Vault's lifecycle state like round and locked amounts
  Vault.VaultState public vaultState;

  /// @notice role in charge of weekly vault operations such as buyRBN
  address public keeper;

  /// @notice Stores addresses of assets of all ribbon vaults
  address[] public vaultAssets;

  /// @notice Stores whether asset already exists
  mapping(address => bool) public vaultAssetMap;

  // Gap is left to avoid storage collisions. Though RibbonVault is not upgradeable, we add this as a safety measure.
  uint256[30] private ____gap;

  // *IMPORTANT* NO NEW STORAGE VARIABLES SHOULD BE ADDED HERE
  // This is to prevent storage collisions. All storage variables should be appended to RibbonThetaVaultStorage
  // or RibbonDeltaVaultStorage instead. Read this documentation to learn more:
  // https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#modifying-your-contracts

  /************************************************
   *  EVENTS
   ***********************************************/

  event Deposit(address indexed account, uint256 amount, uint256 round);

  event InitiateWithdraw(
    address indexed account,
    uint256 shares,
    uint256 round
  );

  event Redeem(address indexed account, uint256 share, uint256 round);

  event CapSet(uint256 oldCap, uint256 newCap, address manager);

  event Withdraw(address indexed account, uint256 amount, uint256 shares);

  event InstantWithdraw(address indexed account, uint256 amount, uint256 round);

  /************************************************
   *  CONSTRUCTOR & INITIALIZATION
   ***********************************************/

  /**
   * @notice Initializes the contract with immutable variables
   * @param _rbn is the RBN contract
   * @param _srbn is the sRBN contract
   */
  constructor(address _rbn, address _srbn) {
    require(_rbn != address(0), "!_rbn");
    require(_srbn != address(0), "!_srbn");

    RBN = _rbn;
    sRBN = ISRBN(_srbn);
  }

  /**
   * @notice Initializes the Vault contract with storage variables.
   * @param _owner is the owner of the vault with critical permissions
   * @param _vaultAssets is ribbon vault assets
   * @param _vaultParams is the struct with vault general data
   */
  function initialize(
    address _owner,
    address _keeper,
    address[] calldata _vaultAssets,
    Vault.VaultParams calldata _vaultParams
  ) external initializer {
    VaultLifecycle.verifyInitializerParams(
      _owner,
      _keeper,
      _vaultAssets,
      _vaultParams
    );

    __ReentrancyGuard_init();
    __Ownable_init();
    transferOwnership(_owner);

    keeper = _keeper;

    vaultParams = _vaultParams;

    vaultState.round = 1;

    for (uint256 i = 0; i < _vaultAssets.length; i++) {
      vaultAssets.push(_vaultAssets[i]);
      vaultAssetMap[_vaultAssets[i]] = true;
    }
  }

  /**
   * @dev Throws if called by any account other than the keeper.
   */
  modifier onlyKeeper() {
    require(msg.sender == keeper, "!keeper");
    _;
  }

  /************************************************
   *  SETTERS
   ***********************************************/

  /**
   * @notice Sets the new keeper
   * @param newKeeper is the address of the new keeper
   */
  function setNewKeeper(address newKeeper) external onlyOwner {
    require(newKeeper != address(0), "!newKeeper");
    keeper = newKeeper;
  }

  /**
   * @notice Adds new asset vaults fees
   * @param newVaultAssets is the list of new addresses
   */
  function addNewVaultAssets(address[] memory newVaultAssets)
    external
    onlyOwner
  {
    require(
      newVaultAssets.length > 0 && newVaultAssets[0] != address(0),
      "!newVaultAssets"
    );

    for (uint256 i = 0; i < newVaultAssets.length; i++) {
      if (!vaultAssetMap[newVaultAssets[i]]) {
        vaultAssets.push(newVaultAssets[i]);
        vaultAssetMap[newVaultAssets[i]] = true;
      }
    }
  }

  /**
   * @notice Sets a new cap for deposits
   * @param newCap is the new cap for deposits
   */
  function setCap(uint256 newCap) external onlyOwner {
    require(newCap > 0, "!newCap");
    ShareMath.assertUint104(newCap);
    vaultParams.cap = uint104(newCap);
  }

  /************************************************
   *  DEPOSIT & WITHDRAWALS
   ***********************************************/

  /**
   * @notice Deposits the `asset` from msg.sender.
   * @param amount is the amount of `asset` to deposit
   */
  function deposit(uint256 amount) external nonReentrant {
    require(amount > 0, "!amount");

    _depositFor(amount, msg.sender);

    // An approve() by the msg.sender is required beforehand
    IERC20(vaultParams.asset).safeTransferFrom(
      msg.sender,
      address(this),
      amount
    );
  }

  /**
   * @notice Deposits the `asset` from msg.sender added to `creditor`'s deposit.
   * @notice Used for vault -> vault deposits on the user's behalf
   * @param amount is the amount of `asset` to deposit
   * @param creditor is the address that can claim/withdraw deposited amount
   */
  function depositFor(uint256 amount, address creditor) external nonReentrant {
    require(amount > 0, "!amount");
    require(creditor != address(0));

    _depositFor(amount, creditor);

    // An approve() by the msg.sender is required beforehand
    IERC20(vaultParams.asset).safeTransferFrom(
      msg.sender,
      address(this),
      amount
    );
  }

  /**
   * @notice Mints the vault shares to the creditor
   * @param amount is the amount of `asset` deposited
   * @param creditor is the address to receieve the deposit
   */
  function _depositFor(uint256 amount, address creditor) private {
    uint256 currentRound = vaultState.round;
    uint256 totalWithDepositedAmount = totalBalance().add(amount);

    require(totalWithDepositedAmount <= vaultParams.cap, "Exceed cap");
    require(
      totalWithDepositedAmount >= vaultParams.minimumSupply,
      "Insufficient balance"
    );

    emit Deposit(creditor, amount, currentRound);

    Vault.DepositReceipt memory depositReceipt = depositReceipts[creditor];

    // If we have an unprocessed pending deposit from the previous rounds, we have to process it.
    uint256 unredeemedShares =
      depositReceipt.getSharesFromReceipt(
        currentRound,
        roundPricePerShare[depositReceipt.round],
        vaultParams.decimals
      );

    uint256 depositAmount = amount;

    // If we have a pending deposit in the current round, we add on to the pending deposit
    if (currentRound == depositReceipt.round) {
      uint256 newAmount = uint256(depositReceipt.amount).add(amount);
      depositAmount = newAmount;
    }

    ShareMath.assertUint104(depositAmount);

    depositReceipts[creditor] = Vault.DepositReceipt({
      round: uint16(currentRound),
      amount: uint104(depositAmount),
      unredeemedShares: uint128(unredeemedShares)
    });

    uint256 newTotalPending = uint256(vaultState.totalPending).add(amount);
    ShareMath.assertUint128(newTotalPending);

    vaultState.totalPending = uint128(newTotalPending);
  }

  /**
   * @notice Initiates a withdrawal that can be processed once the round completes
   * @param numShares is the number of shares to withdraw
   */
  function initiateWithdraw(uint256 numShares) external nonReentrant {
    require(numShares > 0, "!numShares");

    // We do a max redeem before initiating a withdrawal
    // But we check if they must first have unredeemed shares
    if (
      depositReceipts[msg.sender].amount > 0 ||
      depositReceipts[msg.sender].unredeemedShares > 0
    ) {
      _redeem(0, true);
    }

    // This caches the `round` variable used in shareBalances
    uint256 currentRound = vaultState.round;
    Vault.Withdrawal storage withdrawal = withdrawals[msg.sender];

    bool withdrawalIsSameRound = withdrawal.round == currentRound;

    emit InitiateWithdraw(msg.sender, numShares, currentRound);

    uint256 existingShares = uint256(withdrawal.shares);

    uint256 withdrawalShares;
    if (withdrawalIsSameRound) {
      withdrawalShares = existingShares.add(numShares);
    } else {
      require(existingShares == 0, "Existing withdraw");
      withdrawalShares = numShares;
      withdrawals[msg.sender].round = uint16(currentRound);
    }

    ShareMath.assertUint128(withdrawalShares);
    withdrawals[msg.sender].shares = uint128(withdrawalShares);

    uint256 newQueuedWithdrawShares =
      uint256(vaultState.queuedWithdrawShares).add(numShares);
    ShareMath.assertUint128(newQueuedWithdrawShares);
    vaultState.queuedWithdrawShares = uint128(newQueuedWithdrawShares);

    sRBN.transferFrom(msg.sender, address(this), numShares);
  }

  /**
   * @notice Withdraws the assets on the vault using the outstanding `DepositReceipt.amount`
   * @param amount is the amount to withdraw
   */
  function withdrawInstantly(uint256 amount) external nonReentrant {
    Vault.DepositReceipt storage depositReceipt = depositReceipts[msg.sender];

    uint256 currentRound = vaultState.round;
    require(amount > 0, "!amount");
    require(depositReceipt.round == currentRound, "Invalid round");

    uint256 receiptAmount = depositReceipt.amount;
    require(receiptAmount >= amount, "Exceed amount");

    // Subtraction underflow checks already ensure it is smaller than uint104
    depositReceipt.amount = uint104(receiptAmount.sub(amount));
    vaultState.totalPending = uint128(
      uint256(vaultState.totalPending).sub(amount)
    );

    emit InstantWithdraw(msg.sender, amount, currentRound);

    IERC20(vaultParams.asset).safeTransfer(msg.sender, amount);
  }

  /**
   * @notice Completes a scheduled withdrawal from a past round. Uses finalized pps for the round
   */
  function completeWithdraw() external nonReentrant {
    Vault.Withdrawal storage withdrawal = withdrawals[msg.sender];

    uint256 withdrawalShares = withdrawal.shares;
    uint256 withdrawalRound = withdrawal.round;

    // This checks if there is a withdrawal
    require(withdrawalShares > 0, "Not initiated");

    require(withdrawalRound < vaultState.round, "Round not closed");

    // We leave the round number as non-zero to save on gas for subsequent writes
    withdrawals[msg.sender].shares = 0;
    vaultState.queuedWithdrawShares = uint128(
      uint256(vaultState.queuedWithdrawShares).sub(withdrawalShares)
    );

    uint256 withdrawAmount =
      ShareMath.sharesToAsset(
        withdrawalShares,
        roundPricePerShare[withdrawalRound],
        vaultParams.decimals
      );

    emit Withdraw(msg.sender, withdrawAmount, withdrawalShares);

    sRBN.burn(withdrawalShares);

    require(withdrawAmount > 0, "!withdrawAmount");
    IERC20(vaultParams.asset).safeTransfer(msg.sender, withdrawAmount);
  }

  /**
   * @notice Redeems shares that are owed to the account
   * @param numShares is the number of shares to redeem
   */
  function redeem(uint256 numShares) external nonReentrant {
    require(numShares > 0, "!numShares");
    _redeem(numShares, false);
  }

  /**
   * @notice Redeems the entire unredeemedShares balance that is owed to the account
   */
  function maxRedeem() external nonReentrant {
    _redeem(0, true);
  }

  /**
   * @notice Redeems shares that are owed to the account
   * @param numShares is the number of shares to redeem, could be 0 when isMax=true
   * @param isMax is flag for when callers do a max redemption
   */
  function _redeem(uint256 numShares, bool isMax) internal {
    Vault.DepositReceipt memory depositReceipt = depositReceipts[msg.sender];

    // This handles the null case when depositReceipt.round = 0
    // Because we start with round = 1 at `initialize`
    uint256 currentRound = vaultState.round;

    uint256 unredeemedShares =
      depositReceipt.getSharesFromReceipt(
        currentRound,
        roundPricePerShare[depositReceipt.round],
        vaultParams.decimals
      );

    numShares = isMax ? unredeemedShares : numShares;
    if (numShares == 0) {
      return;
    }
    require(numShares <= unredeemedShares, "Exceeds available");

    // If we have a depositReceipt on the same round, BUT we have some unredeemed shares
    // we debit from the unredeemedShares, but leave the amount field intact
    // If the round has past, with no new deposits, we just zero it out for new deposits.
    depositReceipts[msg.sender].amount = depositReceipt.round < currentRound
      ? 0
      : depositReceipt.amount;

    ShareMath.assertUint128(numShares);
    depositReceipts[msg.sender].unredeemedShares = uint128(
      unredeemedShares.sub(numShares)
    );

    emit Redeem(msg.sender, numShares, depositReceipt.round);

    sRBN.transfer(msg.sender, numShares);
  }

  /************************************************
   *  VAULT OPERATIONS
   ***********************************************/

  /**
   * @notice Buy back RBN and net worth go up for depositors
   */
  function buyBackRBN() external onlyKeeper nonReentrant {
    uint256 lockedBalance = _rollToNextWeek();

    ShareMath.assertUint104(lockedBalance);
    vaultState.lockedAmount = uint104(lockedBalance);

    // Buy back RBN
    for (uint256 i = 0; i < vaultAssets.length; i++) {}
  }

  /************************************************
   *  GETTERS
   ***********************************************/

  /**
   * @notice Returns the asset balance held on the vault for the account
   * @param account is the address to lookup balance for
   * @return the amount of `asset` custodied by the vault for the user
   */
  function accountVaultBalance(address account)
    external
    view
    returns (uint256)
  {
    uint256 _decimals = vaultParams.decimals;
    uint256 assetPerShare =
      ShareMath.pricePerShare(
        sRBN.totalSupply(),
        totalBalance(),
        vaultState.totalPending,
        _decimals
      );
    return ShareMath.sharesToAsset(shares(account), assetPerShare, _decimals);
  }

  /**
   * @notice Getter for returning the account's share balance including unredeemed shares
   * @param account is the account to lookup share balance for
   * @return the share balance
   */
  function shares(address account) public view returns (uint256) {
    (uint256 heldByAccount, uint256 heldByVault) = shareBalances(account);
    return heldByAccount.add(heldByVault);
  }

  /**
   * @notice Getter for returning the account's share balance split between account and vault holdings
   * @param account is the account to lookup share balance for
   * @return heldByAccount is the shares held by account
   * @return heldByVault is the shares held on the vault (unredeemedShares)
   */
  function shareBalances(address account)
    public
    view
    returns (uint256 heldByAccount, uint256 heldByVault)
  {
    Vault.DepositReceipt memory depositReceipt = depositReceipts[account];

    if (depositReceipt.round < ShareMath.PLACEHOLDER_UINT) {
      return (sRBN.balanceOf(account), 0);
    }

    uint256 unredeemedShares =
      depositReceipt.getSharesFromReceipt(
        vaultState.round,
        roundPricePerShare[depositReceipt.round],
        vaultParams.decimals
      );

    return (sRBN.balanceOf(account), unredeemedShares);
  }

  /**
   * @notice The price of a unit of share denominated in the `asset`
   */
  function pricePerShare() external view returns (uint256) {
    return
      ShareMath.pricePerShare(
        sRBN.totalSupply(),
        totalBalance(),
        vaultState.totalPending,
        vaultParams.decimals
      );
  }

  /**
   * @notice Returns the vault's total balance, including the amounts locked into a short position
   * @return total balance of the vault, including the amounts locked in third party protocols
   */
  function totalBalance() public view returns (uint256) {
    return
      uint256(vaultState.lockedAmount).add(
        IERC20(vaultParams.asset).balanceOf(address(this))
      );
  }

  /**
   * @notice Returns the token decimals
   */
  function decimals() public view returns (uint8) {
    return vaultParams.decimals;
  }

  function cap() external view returns (uint256) {
    return vaultParams.cap;
  }

  function totalPending() external view returns (uint256) {
    return vaultState.totalPending;
  }

  /************************************************
   *  HELPERS
   ***********************************************/

  /*
   * @notice Helper function that helps to save gas for writing values into the roundPricePerShare map.
   *         Writing `1` into the map makes subsequent writes warm, reducing the gas from 20k to 5k.
   *         Having 1 initialized beforehand will not be an issue as long as we round down share calculations to 0.
   * @param numRounds is the number of rounds to initialize in the map
   */
  function initRounds(uint256 numRounds) external nonReentrant {
    require(numRounds > 0, "!numRounds");

    uint256 _round = vaultState.round;
    for (uint256 i = 0; i < numRounds; i++) {
      uint256 index = _round + i;
      require(index >= _round, "Overflow");
      require(roundPricePerShare[index] == 0, "Initialized"); // AVOID OVERWRITING ACTUAL VALUES
      roundPricePerShare[index] = ShareMath.PLACEHOLDER_UINT;
    }
  }

  /*
   * @notice Helper function that performs most administrative tasks
   * such as getting new locked amount, minting new shares, etc.
   * @return lockedBalance is the new balance used to calculate next weeks locked amount of RBN
   */
  function _rollToNextWeek() internal returns (uint256 lockedBalance) {
    require(block.timestamp >= vaultState.nextBuyback, "!ready");

    vaultState.nextBuyback = VaultLifecycle.getNextFriday(block.timestamp);

    (uint256 _lockedBalance, , uint256 newPricePerShare, uint256 mintShares) =
      VaultLifecycle.rollover(
        sRBN.totalSupply(),
        vaultParams.asset,
        vaultParams.decimals,
        uint256(vaultState.totalPending),
        vaultState.queuedWithdrawShares
      );

    // Finalize the pricePerShare at the end of the round
    uint256 currentRound = vaultState.round;
    roundPricePerShare[currentRound] = newPricePerShare;

    // Take management / performance fee from previous round and deduct
    lockedBalance = _lockedBalance;

    vaultState.totalPending = 0;
    vaultState.round = uint16(currentRound + 1);

    sRBN.mint(address(this), mintShares);

    return lockedBalance;
  }
}
