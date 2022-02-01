// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

/**
 * @title Ribbon Vault Interface
 * @notice Returns price per share of vault token to underlying
 * @dev Implements the `RibbonVault` interface.
 */
interface IRibbonVault {
    function pricePerShare() external view returns (uint256);
    function decimals() external view returns (uint8);
}
