// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IRibbonVault {
  function redeem(uint256 numShares) external;
  function redeemFor(address recipient, uint256 numShares) external;
  function maxRedeem() external;
}
