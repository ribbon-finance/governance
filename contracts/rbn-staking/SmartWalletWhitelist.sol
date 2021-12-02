// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {ISmartWalletChecker} from "../interfaces/ISmartWalletChecker.sol";

contract SmartWalletWhitelist {
  mapping(address => bool) public wallets;
  address public dao;
  address public checker;
  address public future_checker;

  event ApproveWallet(address);
  event RevokeWallet(address);

  //voter for crv: https://etherscan.io/address/0xF147b8125d2ef93FB6965Db97D6746952a133934#code
  constructor(address _dao, address _voter) {
    dao = _dao;
    wallets[_voter] = true;
    emit ApproveWallet(_voter);
  }

  /**
   * @dev Validates that the tx sender is dao contract
   */
  modifier onlyDAO() {
    require(msg.sender == dao, "!dao");
    _;
  }

  function commitSetChecker(address _checker) external onlyDAO {
    future_checker = _checker;
  }

  function applySetChecker() external onlyDAO {
    checker = future_checker;
  }

  function approveWallet(address _wallet) public onlyDAO {
    wallets[_wallet] = true;

    emit ApproveWallet(_wallet);
  }

  function revokeWallet(address _wallet) external onlyDAO {
    wallets[_wallet] = false;

    emit RevokeWallet(_wallet);
  }

  function check(address _wallet) external view returns (bool) {
    bool _check = wallets[_wallet];
    if (_check) {
      return _check;
    } else {
      if (checker != address(0)) {
        return ISmartWalletChecker(checker).check(_wallet);
      }
    }
    return false;
  }
}
