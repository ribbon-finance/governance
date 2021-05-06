// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

interface IRibbonStrangle {
    enum OptionType {Invalid, Put, Call}
    event PositionCreated(
        address indexed account,
        uint256 indexed positionID,
        string[] venues,
        OptionType[] optionTypes,
        uint256 amount
    );
}

interface IRibbonThetaVault {
    function decimals() external view returns (uint8);

    event Deposit(address indexed account, uint256 amount, uint256 share);
}
