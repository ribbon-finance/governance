/*
ERC20StakingModuleFactory

https://github.com/gysr-io/core

SPDX-License-Identifier: MIT
*/

pragma solidity 0.8.4;

import "../../interfaces/IModuleFactory.sol";
import "./ERC20StakingModule.sol";

/**
 * @title ERC20 staking module factory
 *
 * @notice this factory contract handles deployment for the
 * ERC20StakingModule contract
 *
 * @dev it is called by the parent PoolFactory and is responsible
 * for parsing constructor arguments before creating a new contract
 */
contract ERC20StakingModuleFactory is IModuleFactory {
  /**
   * @inheritdoc IModuleFactory
   */
  function createModule(bytes calldata data)
    external
    override
    returns (address)
  {
    // validate
    require(data.length == 32, "smf1");

    // parse staking token
    address token;
    assembly {
      token := calldataload(68)
    }

    // create module
    ERC20StakingModule module = new ERC20StakingModule(token, address(this));
    module.transferOwnership(msg.sender);

    // output
    emit ModuleCreated(msg.sender, address(module));
    return address(module);
  }
}
