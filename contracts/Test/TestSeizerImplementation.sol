// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

contract TestSeizerImplementation {
  uint256 public toRedeem;

  function amountToRedeem(address vestingEscrowContract)
    external
    view
    returns (uint256)
  {
    return toRedeem;
  }

  function setAmountToRedeem(uint256 _amountToRedeem) external {
    toRedeem = _amountToRedeem;
  }

  function sellAndDisperseFunds() external {}
}
