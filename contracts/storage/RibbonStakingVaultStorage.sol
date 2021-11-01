// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {Vault} from "../libraries/Vault.sol";

abstract contract RibbonStakingVaultStorageV1 {}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonThetaVaultStorage
// e.g. RibbonThetaVaultStorage<versionNumber>, so finally it would look like
// contract RibbonThetaVaultStorage is RibbonThetaVaultStorageV1, RibbonThetaVaultStorageV2
abstract contract RibbonStakingVaultStorage is RibbonStakingVaultStorageV1 {
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
}
