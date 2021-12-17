// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IRibbonVault.sol";
import "../interfaces/IStakingRewards.sol";

contract StakingHelper {
  address public immutable vaultToken;
  address public immutable vault;
  address public immutable staking;

  constructor(address _vaultToken, address _vault, address _staking) {
    require(_vaultToken != address(0));
    require(_vault != address(0));
    require(_staking != address(0));

    vaultToken = _vaultToken;
    vault = _vault;
    staking = _staking;
  }

  function stake(uint256 _amount) external {
    IRibbonVault(vault).redeemFor(msg.sender, _amount);
    IERC20(vaultToken).transferFrom(msg.sender, address(this), _amount);
    IERC20(vaultToken).approve(staking, _amount);
    IStakingRewards(staking).stake(_amount);
  }
}
