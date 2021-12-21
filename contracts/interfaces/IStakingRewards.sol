// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

// https://docs.synthetix.io/contracts/source/interfaces/istakingrewards
interface IStakingRewards {
    // Views
    function lastTimeRewardApplicable() external view returns (uint256);

    function rewardPerToken() external view returns (uint256);

    function earned(address account) external view returns (uint256);

    function getRewardForDuration() external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    // Mutative

    function notifyRewardAmount(uint256 reward) external;

    function stake(uint256 amount) external;

    function stakeFor(uint256 amount, address user) external;

    function withdraw(uint256 amount) external;

    function getReward() external;

    function exit() external;
}
