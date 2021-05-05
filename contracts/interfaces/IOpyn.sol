// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

interface IOpynOptionFactory {
    function optionsContracts(uint256 index) external view returns (address);

    function getNumberOfOptionsContracts() external view returns (uint256);
}

interface IOpynOptionTokenV1 {
    event ERC20CollateralAdded(
        address payable vaultOwner,
        uint256 amount,
        address payer
    );
}

interface IOpynController {
    event ShortOtokenMinted(
        address indexed otoken,
        address indexed AccountOwner,
        address indexed to,
        uint256 vaultId,
        uint256 amount
    );
}

interface IOpynOptionTokenV2 {
    function collateralAsset() external pure returns (address);
}
