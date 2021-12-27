// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

abstract contract IIncentivisedVotingLockup {
  function getLastUserPoint(address _addr)
    external
    view
    virtual
    returns (
      int128 bias,
      int128 slope,
      uint128 ts
    );

  function createLock(uint256 _value, uint256 _unlockTime) external virtual;

  function withdraw() external virtual;

  function increaseLockAmount(uint256 _value) external virtual;

  function increaseLockLength(uint256 _unlockTime) external virtual;

  // Governor bravo methods
  function getPriorVotes(address account, uint256 blockNumber)
    external
    view
    virtual
    returns (uint96);
}
