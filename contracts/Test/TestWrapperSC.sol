// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {
  IIncentivisedVotingLockup
} from "../interfaces/IIncentivisedVotingLockup.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TestWrapperSC {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  address public votingLockupEscrow;

  constructor(address _votingLockupEscrow) {
    votingLockupEscrow = _votingLockupEscrow;
  }

  function createLock() external returns (address) {
    IIncentivisedVotingLockup(votingLockupEscrow).createLock(
      3,
      (block.timestamp).add(365 days)
    );
  }

  function increaseLockAmount() external returns (address) {
    IIncentivisedVotingLockup(votingLockupEscrow).increaseLockAmount(3);
  }

  function increaseLockLength() external returns (address) {
    IIncentivisedVotingLockup(votingLockupEscrow).increaseLockLength(
      block.timestamp.add(730 days)
    );
  }

  function approve(address _stakingToken) external returns (address) {
    IERC20 stakingToken = IERC20(_stakingToken);
    stakingToken.safeApprove(
      votingLockupEscrow,
      stakingToken.balanceOf(address(this))
    );
  }
}
