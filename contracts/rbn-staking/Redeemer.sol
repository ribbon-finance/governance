// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {ISeizer} from "../interfaces/ISeizer.sol";
import {IVestingEscrow} from "../interfaces/IVestingEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
  SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract Redeemer {
  using SafeERC20 for IERC20;
  using SafeMath for uint256;

  // Multisig
  address public admin;
  // Maximum % of rbn staked redeemable. 2 decimals i.e 100 * 10 ** 2 = 100% possible to redeem
  uint8 public maxRedeemPCT;
  // Seizer implementation
  ISeizer public seizerImplementation;
  // veCRV escrow contract
  IVestingEscrow public vestingEscrowContract;

  event RBNRedeemed(uint256 amountRedeemed);

  constructor(address _admin, uint8 _maxRedeemPCT) {
    require(_admin != address(0), "!_admin");
    require(_maxRedeemPCT > 0 && _maxRedeemPCT < 10000, "!_maxRedeemPCT");

    admin = _admin;
    maxRedeemPCT = _maxRedeemPCT;
  }

  /**
   * @dev Validates that the tx sender is admin multisig
   */
  modifier onlyAdmin() {
    require(msg.sender == admin, "Must be admin");
    _;
  }

  /**
   * @dev Set new vesting escrow contract
   * @param _vestingEscrowContract new vesting escrow contract
   */
  function setVestingEscrowContract(address _vestingEscrowContract)
    external
    onlyAdmin
  {
    require(_vestingEscrowContract != address(0), "!_vestingEscrowContract");
    vestingEscrowContract = IVestingEscrow(_vestingEscrowContract);
  }

  /**
   * @dev Set new seizer contract implementation
   * @param _seizerImplementation new seizer contract
   */
  function setSeizerImplementation(address _seizerImplementation)
    external
    onlyAdmin
  {
    seizerImplementation = ISeizer(_seizerImplementation);
  }

  /**
   * @dev Set new max redeemeable pct
   * @param _maxRedeemPCT new max redeem pct
   */
  function setMaxRedeemPCT(uint8 _maxRedeemPCT) external onlyAdmin {
    require(_maxRedeemPCT > 0 && _maxRedeemPCT < 10000, "!_maxRedeemPCT");
    maxRedeemPCT = _maxRedeemPCT;
  }

  /**
   * @dev Redeems the rbn
   * @param _maxRedeemPCT new max redeem pct
   */
  function redeemRBN(uint256 _amount) external onlyAdmin {
    uint256 amountToRedeem =
      seizerImplementation == address(0)
        ? _amount
        : seizerImplementation.amountToRedeem(vestingEscrowContract);
    require(
      amountToRedeem <=
        vestingEscrowContract.totalLocked().mul(maxRedeemPCT).div(100 * 10**2)
    );

    vestingEscrowContract.redeemRBN(amountToRedeem);

    emit RBNRedeemed(amountToRedeem);
  }
}
