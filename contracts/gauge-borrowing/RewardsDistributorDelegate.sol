pragma solidity ^0.5.16;

import "../interfaces/Compound/CToken.sol";
import "../interfaces/Compound/EIP20Interface.sol";
import "../common/SafeMath.sol";

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

  /// @dev 100%
  uint256 public constant TOTAL_PCT = 10000;

  /// @dev Start of rewards epoch
  uint256 public startTime;

  /// @dev AVG blocks per week. Each block is on avg 13s = WEEK / 13
  uint256 public avgBlocksPerWeek;

  address public admin;
  address public rewardToken;

  /// @dev total RBN minted
  mapping(address => uint256) public totalMint;
  /// @dev total RBN minted from last epoch
  mapping(address => uint256) public lastEpochTotalMint;
  /// @dev Borrow reward %
  mapping(address => uint256) public borrowerPCT;
  /// @dev Supply reward %
  mapping(address => uint256) public supplierPCT;

  mapping(address => uint256) public compSupplySpeeds;
  mapping(address => uint256) public compBorrowSpeeds;

  /// @notice Emitted when new borrow pct set for cToken
  event NewBorrowerPCT(CToken indexed cToken, uint256 newPCT);
  /// @notice Emitted when new supply pct set for cToken
  event NewSupplierPCT(CToken indexed cToken, uint256 newPCT);
  /// @notice Emitted when average blocks per week updated
  event NewAverageBlocksPerWeek(uint256 newBlocksPerWeek);
  /// @notice Emitted when asset recovered
  event RecoverAsset(address asset, uint256 amount);
  /// @notice Emitted when a new RBN speed is calculated for a market
  event CompSupplySpeedUpdated(CToken indexed cToken, uint256 newSpeed);
  /// @notice Emitted when a new RBN speed is calculated for a market
  event CompBorrowSpeedUpdated(CToken indexed cToken, uint256 newSpeed);
  /// @notice Emitted when RBN sent to contract for rewards on behalf of cToken
  event Burn(CToken indexed cToken, uint256 amount);

  constructor(address _admin) public {
    admin = _admin;
  }

  /// @dev Intitializer to set admin to caller and set reward token and start time of rewards
  function initialize(address _rewardToken, uint256 _startTime) external {
    require(msg.sender == admin, "Only admin can initialize.");
    require(rewardToken == address(0), "Already initialized.");
    require(
      _rewardToken != address(0),
      "Cannot initialize reward token to the zero address."
    );
    require(_startTime != 0, "Cannot initialize start time to 0.");

    rewardToken = _rewardToken;
    startTime = _startTime;
    avgBlocksPerWeek = WEEK.div(13);
  }

  /**
   * @notice Set COMP speed for a single market
   * @param cToken The market whose COMP speed to update
   * @param compSpeed New COMP speed for market
   */
  function setCompSupplySpeedInternal(CToken cToken, uint256 compSpeed)
    internal
  {
    uint256 currentCompSpeed = compSupplySpeeds[address(cToken)];
    if (currentCompSpeed != compSpeed) {
      compSupplySpeeds[address(cToken)] = compSpeed;
    }
    emit CompSupplySpeedUpdated(cToken, compSpeed);
  }

  /**
   * @notice Set COMP speed for a single market
   * @param cToken The market whose COMP speed to update
   * @param compSpeed New COMP speed for market
   */
  function setCompBorrowSpeedInternal(CToken cToken, uint256 compSpeed)
    internal
  {
    uint256 currentCompSpeed = compBorrowSpeeds[address(cToken)];
    if (currentCompSpeed != compSpeed) {
      compBorrowSpeeds[address(cToken)] = compSpeed;
    }
    emit CompBorrowSpeedUpdated(cToken, compSpeed);
  }

  /*** Comp Distribution Admin ***/

  /**
   * @notice Set borrower PCT
   * @param cToken The market whose borrower PCT to update
   * @param _borrowerPCT Borrower PCT
   */
  function _setBorrowerPCT(CToken cToken, uint256 _borrowerPCT) public {
    require(msg.sender == admin, "only admin can set borrower percent");
    require(
      _borrowerPCT.add(supplierPCT[address(cToken)]) <= TOTAL_PCT,
      "Borrow + Supply PCT > 100%"
    );
    borrowerPCT[address(cToken)] = _borrowerPCT;
    emit NewBorrowerPCT(cToken, _borrowerPCT);
  }

  /**
   * @notice Set supply PCT
   * @param cToken The market whose borrower PCT to update
   * @param _supplierPCT Supplier PCT
   */
  function _setSupplierPCT(CToken cToken, uint256 _supplierPCT) public {
    require(msg.sender == admin, "only admin can set supplier percent");
    require(
      borrowerPCT[address(cToken)].add(_supplierPCT) <= TOTAL_PCT,
      "Borrow + Supply PCT > 100%"
    );
    supplierPCT[address(cToken)] = _supplierPCT;
    emit NewSupplierPCT(cToken, _supplierPCT);
  }

  /**
   * @notice Set average block time. Each block will be exactly 12 seconds after merge
   */
  function _setAvgBlocksPerWeek(uint256 _avgBlocksPerWeek) public {
    require(msg.sender == admin, "only admin can set avg blocks per week");
    avgBlocksPerWeek = _avgBlocksPerWeek;
    emit NewAverageBlocksPerWeek(_avgBlocksPerWeek);
  }

  /**
   * @notice
   * recover specific asset
   * @param asset asset to recover
   * @param amount amount to recover
   */
  function _recoverAsset(address asset, uint256 amount) public {
    require(asset != address(0), "!asset");
    require(msg.sender == admin, "only admin can recover asset");
    EIP20Interface(asset).transfer(admin, amount);
    emit RecoverAsset(asset, amount);
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
    uint256 totalToDistribute = totalMint[address(cToken)]
      .sub(lastEpochTotalMint[address(cToken)])
      .div(avgBlocksPerWeek);
    uint256 toDistributeToBorrower = totalToDistribute
      .mul(borrowerPCT[address(cToken)])
      .div(TOTAL_PCT);
    uint256 toDistributeToSupplier = totalToDistribute
      .mul(supplierPCT[address(cToken)])
      .div(TOTAL_PCT);
    lastEpochTotalMint[address(cToken)] = totalMint[address(cToken)];
    startTime = startTime.add(WEEK);
    setCompBorrowSpeedInternal(cToken, toDistributeToBorrower);
    setCompSupplySpeedInternal(cToken, toDistributeToSupplier);
  }

  /**
   * @notice Burn
   * @param cToken cToken to burn for
   * @param amount Amount of RBN tokens
   */
  function burn(CToken cToken, uint256 amount) external {
    EIP20Interface(rewardToken).transferFrom(msg.sender, address(this), amount);
    totalMint[address(cToken)] = totalMint[address(cToken)].add(amount);
    emit Burn(cToken, amount);
  }
}
