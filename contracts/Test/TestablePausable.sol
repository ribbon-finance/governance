// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "../common/Owned.sol";
import "../common/Pausable.sol";

/**
 * @title An implementation of Pausable. Used to test the features of the Pausable contract that can only be tested by an implementation.
 */
contract TestablePausable is Owned, Pausable {
    uint256 public someValue;

    constructor(address _owner) Owned(_owner) Pausable() {}

    function setSomeValue(uint256 _value) external notPaused {
        someValue = _value;
    }
}
