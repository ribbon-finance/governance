// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {
  IIncentivisedVotingLockup
} from "../interfaces/IIncentivisedVotingLockup.sol";

contract TestCVX {
  address public votingLockupEscrow;

  constructor(address _votingLockupEscrow) {
    votingLockupEscrow = _votingLockupEscrow;
  }

  function createLock() external view returns (address) {
    IIncentivisedVotingLockup(votingLockupEscrow).createLock(
      3,
      block.timestamp.add(1 years)
    );
  }

  function increaseLockAmount() external view returns (address) {
    IIncentivisedVotingLockup(votingLockupEscrow).createLock(
      3,
      block.timestamp.add(1 years)
    );
    IIncentivisedVotingLockup(votingLockupEscrow).increaseLockAmount(3);
  }

  function increaseLockLength() external view returns (address) {
    IIncentivisedVotingLockup(votingLockupEscrow).createLock(
      3,
      block.timestamp.add(1 years)
    );
    IIncentivisedVotingLockup(votingLockupEscrow).increaseLockLength(
      block.timestamp.add(2 years)
    );
  }
}
