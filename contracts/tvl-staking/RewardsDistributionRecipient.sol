// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

// Inheritance
import "../common/Owned.sol";

// https://docs.synthetix.io/contracts/source/contracts/rewardsdistributionrecipient
abstract contract RewardsDistributionRecipient is Owned {
  address public rewardsDistribution;

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
