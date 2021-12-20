// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

// Inheritance
import "../common/Owned.sol";

// https://docs.synthetix.io/contracts/source/contracts/rewardsdistributionrecipient
abstract contract DualRewardsDistributionRecipient is Owned {
  address public rewardsDistribution;

  function notifyRewardAmount(uint256 reward0, uint256 reward1)
    external
    virtual;

  modifier onlyRewardsDistribution() {
    require(
      msg.sender == rewardsDistribution,
      "Caller is not RewardsDistribution contract"
    );
    _;
  }

  function setRewardsDistribution(address _rewardsDistribution)
    external
    onlyOwner
  {
    rewardsDistribution = _rewardsDistribution;
  }
}
