// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {ISeizer} from "../interfaces/ISeizer.sol";
import {IVotingEscrow} from "../interfaces/IVotingEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
  SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Redeemer is Ownable {
  using SafeERC20 for IERC20;
  using SafeMath for uint256;

  // Maximum % of rbn staked redeemable. 2 decimals i.e 100 * 10 ** 2 = 100% possible to redeem
  uint8 public maxRedeemPCT;
  // Seizer implementation
  ISeizer public seizerImplementation;
  // veCRV escrow contract
  IVotingEscrow public votingEscrowContract;

  event RBNRedeemed(uint256 amountRedeemed);

  /**
   * @param _newOwner new owner
   * @param _maxRedeemPCT max redeem pct
   */
  constructor(address _newOwner, uint8 _maxRedeemPCT) {
    require(
      _maxRedeemPCT > 0 && _maxRedeemPCT < 10000,
      "maxRedeemPCT is not between 0% - 100%"
    );

    if (_newOwner != address(0)) {
      transferOwnership(_newOwner);
    }
    maxRedeemPCT = _maxRedeemPCT;
  }

  /**
   * @dev Set new voting escrow contract
   * @param _votingEscrowContract new voting escrow contract
   */
  function setVotingEscrowContract(address _votingEscrowContract)
    external
    onlyOwner
  {
    require(_votingEscrowContract != address(0), "votingEscrowContract is 0x0");
    votingEscrowContract = IVotingEscrow(_votingEscrowContract);
  }

  /**
   * @dev Set new seizer contract implementation
   * @param _seizerImplementation new seizer contract
   */
  function setSeizerImplementation(address _seizerImplementation)
    external
    onlyOwner
  {
    seizerImplementation = ISeizer(_seizerImplementation);
  }

  /**
   * @dev Set new max redeemeable pct
   * @param _maxRedeemPCT new max redeem pct
   */
  function setMaxRedeemPCT(uint8 _maxRedeemPCT) external onlyOwner {
    require(
      _maxRedeemPCT > 0 && _maxRedeemPCT < 10000,
      "maxRedeemPCT is not between 0% - 100%"
    );
    maxRedeemPCT = _maxRedeemPCT;
  }

  /**
   * @dev Redeems the rbn
   * @param _amount is the amount
   */
  function redeemRBN(uint256 _amount) external onlyOwner {
    require(
      address(votingEscrowContract) != address(0),
      "votingEscrowContract is 0x0"
    );

    uint256 amountToRedeem =
      address(seizerImplementation) == address(0)
        ? _amount
        : seizerImplementation.amountToRedeem(address(votingEscrowContract));
    require(
      amountToRedeem <=
        votingEscrowContract.totalLocked().mul(maxRedeemPCT).div(100 * 10**2)
    );

    votingEscrowContract.redeemRBN(amountToRedeem);

    emit RBNRedeemed(amountToRedeem);
  }

  /**
   * @dev Sends the token to owner
   * @param _token token address
   * @param _amount token amount
   */
  function sendToAdmin(address _token, uint256 _amount) external onlyOwner {
    IERC20(_token).safeTransfer(owner(), _amount);
  }

  /**
   * @dev Sells RBN for vault assets and disperses accordingly
   */
  function sellAndDisperseFunds() external onlyOwner {
    require(
      address(seizerImplementation) != address(0),
      "seizerImplementation is 0x0"
    );
    seizerImplementation.sellAndDisperseFunds();
  }
}
