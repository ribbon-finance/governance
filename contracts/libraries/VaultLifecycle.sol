// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
  SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Vault} from "./Vault.sol";
import {ShareMath} from "./ShareMath.sol";

library VaultLifecycle {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  /**
     * @notice Calculate the shares to mint, new price per share, and
      amount of funds to re-allocate as collateral for the new round
     * @param currentShareSupply is the total supply of shares
     * @param asset is the address of the vault's asset
     * @param decimals is the decimals of the asset
     * @param pendingAmount is the amount of funds pending from recent deposits
     * @return newLockedAmount is the amount of funds to allocate for the new round
     * @return queuedWithdrawAmount is the amount of funds set aside for withdrawal
     * @return newPricePerShare is the price per share of the new round
     * @return mintShares is the amount of shares to mint from deposits
     */
  function rollover(
    uint256 currentShareSupply,
    address asset,
    uint256 decimals,
    uint256 pendingAmount,
    uint256 queuedWithdrawShares
  )
    external
    view
    returns (
      uint256 newLockedAmount,
      uint256 queuedWithdrawAmount,
      uint256 newPricePerShare,
      uint256 mintShares
    )
  {
    uint256 currentBalance = IERC20(asset).balanceOf(address(this));

    newPricePerShare = ShareMath.pricePerShare(
      currentShareSupply,
      currentBalance,
      pendingAmount,
      decimals
    );

    // After closing the short, if the options expire in-the-money
    // vault pricePerShare would go down because vault's asset balance decreased.
    // This ensures that the newly-minted shares do not take on the loss.
    uint256 _mintShares =
      ShareMath.assetToShares(pendingAmount, newPricePerShare, decimals);

    uint256 newSupply = currentShareSupply.add(_mintShares);

    uint256 queuedWithdraw =
      newSupply > 0
        ? ShareMath.sharesToAsset(
          queuedWithdrawShares,
          newPricePerShare,
          decimals
        )
        : 0;

    return (
      currentBalance.sub(queuedWithdraw),
      queuedWithdraw,
      newPricePerShare,
      _mintShares
    );
  }

  /**
   * @notice Verify the constructor params satisfy requirements
   * @param owner is the owner of the vault with critical permissions
   * @param vaultAssets is ribbon vault assets
   * @param _vaultParams is the struct with vault general data
   */
  function verifyInitializerParams(
    address owner,
    address keeper,
    address[] calldata vaultAssets,
    Vault.VaultParams calldata _vaultParams
  ) external pure {
    require(owner != address(0), "!owner");
    require(keeper != address(0), "!keeper");

    require(
      vaultAssets.length > 0 && vaultAssets[0] != address(0),
      "!_vaultAssets"
    );

    require(_vaultParams.asset != address(0), "!asset");
    require(_vaultParams.minimumSupply > 0, "!minimumSupply");
    require(_vaultParams.cap > 0, "!cap");
    require(
      _vaultParams.cap > _vaultParams.minimumSupply,
      "cap has to be higher than minimumSupply"
    );
  }

  /**
   * @notice Gets the next options expiry timestamp
   * @param currentExpiry is the expiry timestamp of the current option
   * Reference: https://codereview.stackexchange.com/a/33532
   * Examples:
   * getNextFriday(week 1 thursday) -> week 1 friday
   * getNextFriday(week 1 friday) -> week 2 friday
   * getNextFriday(week 1 saturday) -> week 2 friday
   */
  function getNextFriday(uint256 currentExpiry)
    internal
    pure
    returns (uint256)
  {
    // dayOfWeek = 0 (sunday) - 6 (saturday)
    uint256 dayOfWeek = ((currentExpiry / 1 days) + 4) % 7;
    uint256 nextFriday = currentExpiry + ((7 + 5 - dayOfWeek) % 7) * 1 days;
    uint256 friday8am = nextFriday - (nextFriday % (24 hours)) + (8 hours);

    // If the passed currentExpiry is day=Friday hour>8am, we simply increment it by a week to next Friday
    if (currentExpiry >= friday8am) {
      friday8am += 7 days;
    }
    return friday8am;
  }
}
