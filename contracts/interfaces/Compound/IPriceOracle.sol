// SPDX-License-Identifier: BSD-3-Clause
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

import "./ICToken.sol";

interface IPriceOracle {
    /**
      * @notice Get the underlying price of a cToken asset
      * @param cToken The cToken to get the underlying price of
      * @return The underlying asset price mantissa (scaled by 1e18).
      *  Zero means the price is unavailable.
      */
    function getUnderlyingPrice(ICToken cToken) external view returns (uint);
}
