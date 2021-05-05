// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

interface IOpynOptionFactory {
    function optionsContracts(uint256 index) external view returns (address);

    function getNumberOfOptionsContracts() external view returns (uint256);
}

interface IOpynOptionToken {
    function collateralAsset() external pure returns (address);
}
