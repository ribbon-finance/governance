// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

interface ISmartWalletChecker {
  // Views
  function check(address) external view returns (bool);
}
