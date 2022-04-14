// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface IWSTETH {
  function unwrap(uint256 _amount) external returns (uint256);

  function balanceOf(address account) external view returns (uint256);
}
