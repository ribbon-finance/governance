// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

/**
 * @title LiquidityGauge Interface
 * @notice Returns the LP token of a gauge (vault token like rETH-THETA)
 * @dev Implements the `LiquidityGauge` interface.
 */
interface ILiquidityGauge {
    function lp_token() external view returns (address);
}
