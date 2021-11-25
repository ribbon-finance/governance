// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

contract TestChecker {
  mapping(address => bool) public wallets;

  /**
   * @dev Sets the wallet to whitelist / not whitelisted
   * @param _wallet is the wallet we are setting
   * @param _set is the bool value we are setting
   */
  function setWallet(address _wallet, bool _set) external {
    wallets[_wallet] = _set;
  }

  /**
   * @dev Check whether wallet is whitelisted
   * @param _wallet is the wallet we are checking
   */
  function check(address _wallet) external view returns (bool) {
    return wallets[_wallet];
  }
}
