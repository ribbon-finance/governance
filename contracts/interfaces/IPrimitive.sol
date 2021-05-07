// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

interface IPrimitiveLiquidity {
    event AddLiquidity(
        address indexed from,
        address indexed option,
        uint256 sum
    );
}
