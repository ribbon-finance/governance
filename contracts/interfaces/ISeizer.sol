// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

interface ISeizer {
  function amountToRedeem(address vestingEscrowContract)
    external
    view
    returns (uint256);

  function sellAndDisperseFunds() external;
}
