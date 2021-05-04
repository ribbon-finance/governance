// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IOptionMarket {
    function shortTokens(uint256 index) external view returns (IOptionToken);

    function numStrikes() external view returns (uint256);
}

interface IOptionFactory {
    function markets(uint256 index) external view returns (IOptionMarket);

    function numMarkets() external view returns (uint256);
}

interface IOptionToken {
    function market() external pure returns (address);

    function decimals() external view returns (uint8);
}
