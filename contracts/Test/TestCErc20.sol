pragma solidity ^0.5.16;

import "../interfaces/Compound/EIP20Interface.sol";

interface RibbonMinter {
  function mint(address gauge_addr) external;
}

interface RewardsDistributor {
  function burn(address cToken, uint256 amount) external;
}

/**
 * @title Compound's CErc20 Contract
 * @notice CTokens which wrap an EIP-20 underlying
 * @dev This contract should not to be deployed on its own; instead, deploy `CErc20Delegator` (proxy contract) and `CErc20Delegate` (logic/implementation contract).
 * @author Compound
 */
contract TestCErc20 {
  // Minter contract for rbn gauge emissions
  RibbonMinter public constant RBN_MINTER =
    RibbonMinter(0x5B0655F938A72052c46d2e94D206ccB6FF625A3A);
  // RBN token
  EIP20Interface public constant RBN =
    EIP20Interface(0x6123B0049F904d730dB3C36a31167D9d4121fA6B);
  // Rewards distributor
  // https://github.com/Rari-Capital/compound-protocol/blob/fuse-final/contracts/RewardsDistributorDelegator.sol
  RewardsDistributor public rewardsDistributor;
  address public underlying;

  address public admin;

  constructor(address _admin) public {
    admin = _admin;
  }

  /**
   * @notice Initialize the new money market
   * @param underlying_ The address of the underlying asset
   */
  function initialize(address underlying_) public {
    // Set underlying and sanity check it
    underlying = underlying_;
  }

  function hasAdminRights() internal returns (bool) {
    return msg.sender == admin;
  }

  /**
   * @notice Admin call to set rewards distributor
   * @param _rewardsDistributor The rewards contract
   */
  function _setRewardsDistributor(address _rewardsDistributor) external {
    require(
      hasAdminRights(),
      "only the admin may set the rewards distributor delegate"
    );
    require(
      _rewardsDistributor != address(0),
      "rewards distributor must be set"
    );

    rewardsDistributor = RewardsDistributor(_rewardsDistributor);
  }

  /**
   * @notice Anyone can claim gauge rewards for collateralized gauge tokens.
   */
  function claimGaugeRewards() external {
    require(
      address(rewardsDistributor) != address(0),
      "rewards distributor must be set"
    );

    // Underlying is the gauge token like rETH-THETA-gauge
    RBN_MINTER.mint(underlying);

    uint256 toDistribute = RBN.balanceOf(address(this));

    if (toDistribute == 0) {
      return;
    }

    RBN.approve(address(rewardsDistributor), toDistribute);

    /*
     * Transfer rewards to reward distributor which will distribute rewards
     * to those who supply / borrow. The reason we need to do this way is
     * once individuals transfer the collateral (gauge tokens) to the cToken
     * contract, they forfeit their rewards and now the cToken starts accumulating
     * rewards. We want to redistribute some of it back to those supplying
     * gauge tokens as collateral who 'should' be getting those rewards, and some
     * to DAI / USDC suppliers
     */

    rewardsDistributor.burn(address(this), toDistribute);
  }
}
