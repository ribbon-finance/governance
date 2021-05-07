// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

interface IHegic {
    function balanceOf(address account) external view returns (uint256);

    function decimals() external view returns (uint256);

    event Provide(address indexed account, uint256 amount, uint256 writeAmount);
}
