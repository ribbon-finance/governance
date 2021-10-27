// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISRBN is IERC20 {
    function burn(uint256 amount) external;
    function mint(address dst, uint rawAmount) external;
}
