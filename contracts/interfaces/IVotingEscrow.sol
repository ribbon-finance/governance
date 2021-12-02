// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

interface IVotingEscrow {
  function stakingToken() external view returns (address);

  function redeemRBN(uint256 amountToRedeem) external;
}
