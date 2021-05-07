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

interface IRibbonStrangleHegic {
    event Create(
        uint256 indexed id,
        address indexed account,
        uint256 settlementFee,
        uint256 totalFee
    );
}

interface IRibbonThetaVault {
    function decimals() external view returns (uint8);

    function asset() external view returns (address);

    event Deposit(address indexed account, uint256 amount, uint256 share);
}
