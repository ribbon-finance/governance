//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract RibbonToken is ERC20Pausable, ERC20Burnable, Ownable{

	constructor(string memory name, string memory symbol, uint256 totalSupply, address owner)
		public
		ERC20(name, symbol) {
			// We are minting a total of initialSupply tokens, and it is capped at that value
			_mint(owner, totalSupply);
			// Transferring ownership to the new owner
			transferOwnership(owner);
	}

  // This function reverts if the caller is not the owner.
  function pause() external onlyOwner {
    _pause();
  }

  // This function reverts if the caller is not the owner.
  function unpause() external onlyOwner {
    _unpause();
  }

  function _beforeTokenTransfer(address from, address to, uint256 amount) internal override(ERC20, ERC20Pausable) {
    ERC20Pausable._beforeTokenTransfer(from, to, amount);
  }
}
