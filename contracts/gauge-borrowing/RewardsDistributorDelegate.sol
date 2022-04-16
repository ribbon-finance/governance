pragma solidity ^0.5.16;

import "../interfaces/Compound/ICToken.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title RewardsDistributorDelegate (COMP distribution logic extracted from `Comptroller`)
 * @author Compound
 */
contract RewardsDistributorDelegate {
  using SafeMath for uint256;

  /// @dev Notice that this contract is a RewardsDistributor
  bool public constant isRewardsDistributor = true;

  /// @dev WEEK
  uint256 public constant WEEK = 604800;

  /// @dev AVG blocks per week. Each block is on avg 13s
  uint256 public constant AVG_BLOCKS_PER_WEEK = WEEK.div(13);

  /// @dev 100%
  uint256 public constant TOTAL_PCT = 10000;

  /// @dev Start of rewards epoch
  uint256 public startTime;

  /// @dev total RBN minted from last epoch
  uint256 public lastEpochTotalMint;

  /// @dev total RBN minted
  uint256 public totalMint;

  /// @dev Borrow reward %
  uint256 public borrowerPCT;

  /// @dev Supply reward %
  uint256 public supplierPCT;

  mapping(address => uint256) public compSupplySpeeds;
  mapping(address => uint256) public compBorrowSpeeds;

  address admin;
  address rewardToken;

  constructor(address _admin) public {
    admin = _admin;
  }

  /// @dev Intitializer to set admin to caller and set reward token and start time of rewards
  function initialize(
    address _rewardToken,
    uint256 _startTime,
    uint256 _borrowerPCT
  ) external {
    require(msg.sender == admin, "Only admin can initialize.");
    require(rewardToken == address(0), "Already initialized.");
    require(
      _rewardToken != address(0),
      "Cannot initialize reward token to the zero address."
    );
    require(
      _startTime != 0,
      "Cannot initialize start time to the zero address."
    );

    rewardToken = _rewardToken;
    startTime = _startTime;
    borrowerPCT = _borrowerPCT;
    supplierPCT = TOTAL_PCT.sub(_borrowerPCT);
  }

  /**
   * @notice Set COMP speed for a single market
   * @param cToken The market whose COMP speed to update
   * @param compSpeed New COMP speed for market
   */
  function setCompSupplySpeedInternal(ICToken cToken, uint256 compSpeed)
    internal
  {
    uint256 currentCompSpeed = compSupplySpeeds[address(cToken)];
    if (currentCompSpeed != compSpeed) {
      compSupplySpeeds[address(cToken)] = compSpeed;
    }
  }

  /**
   * @notice Set COMP speed for a single market
   * @param cToken The market whose COMP speed to update
   * @param compSpeed New COMP speed for market
   */
  function setCompBorrowSpeedInternal(ICToken cToken, uint256 compSpeed)
    internal
  {
    uint256 currentCompSpeed = compBorrowSpeeds[address(cToken)];
    if (currentCompSpeed != compSpeed) {
      compBorrowSpeeds[address(cToken)] = compSpeed;
    }
  }

  /*** Comp Distribution Admin ***/

  /**
   * @notice Set borrower PCT
   */
  function _setBorrowerPCT(uint256 _borrowerPCT) public {
    require(msg.sender == admin, "only admin can set borrower percent");
    borrowerPCT = _borrowerPCT;
    supplierPCT = TOTAL_PCT.sub(_borrowerPCT);
  }

  /**
   * @notice Set new borrow / supply speed
   * @param cToken The market whose COMP speed to update
   */
  function updateSpeedWithNewEpoch(CToken cToken) external {
    require(
      block.timestamp.sub(startTime) >= WEEK,
      "Must be at least week since latest epoch"
    );
    uint256 totalToDistribute = totalMint.sub(lastEpochTotalMint).div(
      AVG_BLOCKS_PER_WEEK
    );
    uint256 toDistributeToBorrower = toDistribute.mul(borrowerPCT).div(
      TOTAL_PCT
    );
    lastEpochTotalMint = totalMint;
    startTime = startTime.add(WEEK);
    setCompBorrowSpeedInternal(cToken, toDistributeToBorrower);
    setCompSupplySpeedInternal(
      cToken,
      toDistribute.sub(toDistributeToBorrower)
    );
  }

  /**
   * @notice Burn
   * @param Takes in RBN tokens
   */
  function burn(uint256 amount) external {
    IERC20(rewardToken).transferFrom(msg.sender, address(this), amount);
    totalMint = totalMint.add(amount);
  }
}
