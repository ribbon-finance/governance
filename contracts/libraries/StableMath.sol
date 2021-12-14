// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

/**
 * @title   StableMath
 * @author  mStable
 * @notice  A library providing safe mathematical operations to multiply and
 *          divide with standardised precision.
 * @dev     Derives from OpenZeppelin's SafeMath lib and uses generic system
 *          wide variables for managing precision.
 */
library StableMath {
  /**
   * @dev Scaling unit for use in specific calculations,
   * where 1 * 10**18, or 1e18 represents a unit '1'
   */
  uint256 private constant FULL_SCALE = 1e18;

  /**
   * @dev Token Ratios are used when converting between units of bAsset, mAsset and MTA
   * Reasoning: Takes into account token decimals, and difference in base unit (i.e. grams to Troy oz for gold)
   * bAsset ratio unit for use in exact calculations,
   * where (1 bAsset unit * bAsset.ratio) / ratioScale == x mAsset unit
   */
  uint256 private constant RATIO_SCALE = 1e8;

  /**
   * @dev Scales a given integer to the power of the full scale.
   * @param x   Simple uint256 to scale
   * @return    Scaled value a to an exact number
   */
  function scaleInteger(uint256 x) internal pure returns (uint256) {
    return x * FULL_SCALE;
  }

  /***************************************
              PRECISE ARITHMETIC
    ****************************************/

  /**
   * @dev Multiplies two precise units, and then truncates by the full scale
   * @param x     Left hand input to multiplication
   * @param y     Right hand input to multiplication
   * @return      Result after multiplying the two inputs and then dividing by the shared
   *              scale unit
   */
  function mulTruncate(uint256 x, uint256 y) internal pure returns (uint256) {
    return mulTruncateScale(x, y, FULL_SCALE);
  }

  /**
   * @dev Multiplies two precise units, and then truncates by the given scale. For example,
   * when calculating 90% of 10e18, (10e18 * 9e17) / 1e18 = (9e36) / 1e18 = 9e18
   * @param x     Left hand input to multiplication
   * @param y     Right hand input to multiplication
   * @param scale Scale unit
   * @return      Result after multiplying the two inputs and then dividing by the shared
   *              scale unit
   */
  function mulTruncateScale(
    uint256 x,
    uint256 y,
    uint256 scale
  ) internal pure returns (uint256) {
    // e.g. assume scale = fullScale
    // z = 10e18 * 9e17 = 9e36
    // return 9e36 / 1e18 = 9e18
    return (x * y) / scale;
  }

  /**
   * @dev Returns the downcasted int112 from int256, reverting on
   * overflow (when the input is less than smallest int112 or
   * greater than largest int112).
   *
   * Counterpart to Solidity's `int112` operator.
   *
   * Requirements:
   *
   * - input must fit into 112 bits
   *
   * _Available since v3.1._
   */
  function toInt112(int256 value) internal pure returns (int112) {
    require(
      value >= type(int112).min && value <= type(int112).max,
      "SafeCast: value doesn't fit in 112 bits"
    );
    return int112(value);
  }

  function abs(int256 x) internal pure returns (int256) {
    return x >= 0 ? x : -x;
  }
}
