// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICharmOptionMarket {
    function shortTokens(uint256 index)
        external
        view
        returns (ICharmOptionToken);

    function numStrikes() external view returns (uint256);

    function baseToken() external view returns (address);
}

interface ICharmOptionFactory {
    function markets(uint256 index) external view returns (ICharmOptionMarket);

    function numMarkets() external view returns (uint256);
}

interface ICharmOptionToken {
    event Transfer(address indexed from, address indexed to, uint256 value);
}
