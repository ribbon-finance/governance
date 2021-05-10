// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * Wen hat?
 */
contract RibbonHatToken is ERC20Pausable, AccessControl {
  /// @dev The identifier of the role which maintains other roles.
  bytes32 public constant ADMIN_ROLE = keccak256("ADMIN");

  constructor(
    string memory name,
    string memory symbol,
    uint256 totalSupply,
    address beneficiary
  ) ERC20(name, symbol) {
    // We are minting initialSupply number of tokens
    _mint(beneficiary, totalSupply);

    // Add beneficiary as admin
    _setupRole(ADMIN_ROLE, beneficiary);
  }

  function pause() external onlyAdmin whenNotPaused {
    _pause();
  }

  function unpause() external onlyAdmin whenPaused {
    _unpause();
  }

  function decimals() public pure override returns (uint8) {
    return 0;
  }

  /// @dev A modifier which checks that the caller has the admin role.
  modifier onlyAdmin() {
    require(hasRole(ADMIN_ROLE, msg.sender), "RibbonHatToken: only admin");
    _;
  }
}
