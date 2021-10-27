// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
  SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
  RibbonStakingVaultStorage
} from "../storage/RibbonStakingVaultStorage.sol";
import {Vault} from "../libraries/Vault.sol";
import {VaultLifecycle} from "../libraries/VaultLifecycle.sol";
import {ShareMath} from "../libraries/ShareMath.sol";
import {RibbonVault} from "./base/RibbonVault.sol";

/**
 * UPGRADEABILITY: Since we use the upgradeable proxy pattern, we must observe
 * the inheritance chain closely.
 * Any changes/appends in storage variable needs to happen in RibbonThetaVaultStorage.
 * RibbonThetaVault should not inherit from any other contract aside from RibbonVault, RibbonThetaVaultStorage
 */
contract RibbonStakingVault is RibbonVault, RibbonStakingVaultStorage {
  using SafeERC20 for IERC20;
  using SafeMath for uint256;
  using ShareMath for Vault.DepositReceipt;

  /************************************************
   *  IMMUTABLES & CONSTANTS
   ***********************************************/

  /************************************************
   *  EVENTS
   ***********************************************/

  event InstantWithdraw(address indexed account, uint256 amount, uint256 round);

  /************************************************
   *  CONSTRUCTOR & INITIALIZATION
   ***********************************************/

  /**
   * @notice Initializes the contract with immutable variables
   * @param _rbn is the RBN contract
   */
  constructor(address _rbn) RibbonVault(_rbn) {}

  /**
   * @notice Initializes the Vault contract with storage variables.
   * @param _owner is the owner of the vault with critical permissions
   * @param _vaultAssets is ribbon vault assets
   * @param _vaultParams is the struct with vault general data
   */
  function initialize(
    address _owner,
    address _keeper,
    address[] memory _vaultAssets,
    Vault.VaultParams calldata _vaultParams
  ) external initializer {
    baseInitialize(_owner, _keeper, _vaultAssets, _vaultParams);
  }

  /************************************************
   *  SETTERS
   ***********************************************/

  /************************************************
   *  VAULT OPERATIONS
   ***********************************************/

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
   * @notice Buy back RBN and net worth go up for depositors
   */
  function buyBackRBN() external onlyKeeper nonReentrant {
    uint256 lockedBalance = _rollToNextWeek();

    ShareMath.assertUint104(lockedBalance);
    vaultState.lockedAmount = uint104(lockedBalance);

    // Buy back RBN
    for (uint256 i = 0; i < vaultAssets.length; i++) {}
  }
}
