// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

interface IChainlink {
    function decimals() external view returns (uint256);

    function latestAnswer() external view returns (uint256);
}
