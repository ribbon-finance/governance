// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// Inheritance
import "../interfaces/IDualStakingRewards.sol";
import "./DualRewardsDistributionRecipient.sol";
import "../common/Pausable.sol";

// https://docs.synthetix.io/contracts/source/contracts/stakingrewards
contract DualStakingRewards is
  IDualStakingRewards,
  DualRewardsDistributionRecipient,
  ReentrancyGuard,
  Pausable
{
  using SafeMath for uint256;
  using SafeCast for uint256;
  using SafeERC20 for IERC20;

  struct Rewards {
    uint128 token0;
    uint128 token1;
  }

  /* ========== STATE VARIABLES ========== */

  IERC20 public rewardsToken0;
  IERC20 public rewardsToken1;
  IERC20 public stakingToken;
  Rewards public rewardRate;
  Rewards public rewardPerTokenStored;
  uint256 public periodFinish = 0;
  uint256 public rewardsDuration = 28 days;
  uint256 public lastUpdateTime;

  // timestamp dictating at what time of week to release rewards
  // (ex: 1619226000 is Sat Apr 24 2021 01:00:00 GMT+0000 which will release as 1 am every saturday)
  uint256 public startEmission;

  mapping(address => Rewards) public userRewardPerTokenPaid;
  mapping(address => Rewards) public rewards;

  uint256 private _totalSupply;
  mapping(address => uint256) private _balances;

  /* ========== CONSTRUCTOR ========== */

  constructor(
    address _owner,
    address _rewardsDistribution,
    address _rewardsToken0,
    address _rewardsToken1,
    address _stakingToken,
    uint256 _startEmission
  ) Owned(_owner) {
    require(_owner != address(0), "Owner must be non-zero address");
    require(
      _rewardsToken0 != address(0),
      "Rewards token must be non-zero address"
    );
    require(
      _rewardsToken1 != address(0),
      "Rewards token must be non-zero address"
    );
    require(
      _stakingToken != address(0),
      "Staking token must be non-zero address"
    );
    require(
      _rewardsDistribution != address(0),
      "Rewards Distributor must be non-zero address"
    );
    require(
      _startEmission > block.timestamp,
      "Start Emission must be in the future"
    );

    rewardsToken0 = IERC20(_rewardsToken0);
    rewardsToken1 = IERC20(_rewardsToken1);
    stakingToken = IERC20(_stakingToken);
    rewardsDistribution = _rewardsDistribution;
    startEmission = _startEmission;
  }

  /* ========== VIEWS ========== */

  function totalSupply() external view override returns (uint256) {
    return _totalSupply;
  }

  function balanceOf(address account) external view override returns (uint256) {
    return _balances[account];
  }

  // The minimum between periodFinish and the last instance of the current startEmission release time
  function lastTimeRewardApplicable() public view override returns (uint256) {
    return
      Math.min(
        _numWeeksPassed(block.timestamp).mul(1 weeks).add(startEmission),
        periodFinish
      );
  }

  function rewardPerToken() public view override returns (uint256, uint256) {
    Rewards memory _rewardPerTokenStored = rewardPerTokenStored;
    uint256 totalSupply_ = _totalSupply;
    if (totalSupply_ == 0) {
      return (_rewardPerTokenStored.token0, _rewardPerTokenStored.token1);
    }

    Rewards memory _rewardRate = rewardRate;
    uint256 _lastTimeRewardApplicable = lastTimeRewardApplicable();
    uint256 _lastUpdateTime = lastUpdateTime;
    return (
      uint256(_rewardPerTokenStored.token0).add(
        _lastTimeRewardApplicable
          .sub(_lastUpdateTime)
          .mul(_rewardRate.token0)
          .mul(1e18)
          .div(totalSupply_)
      ),
      uint256(_rewardPerTokenStored.token1).add(
        _lastTimeRewardApplicable
          .sub(_lastUpdateTime)
          .mul(_rewardRate.token1)
          .mul(1e18)
          .div(totalSupply_)
      )
    );
  }

  function earned(address account)
    public
    view
    override
    returns (uint256, uint256)
  {
    (uint256 rewardPerToken0, uint256 rewardPerToken1) = rewardPerToken();
    Rewards memory _userRewardPerTokenPaid = userRewardPerTokenPaid[account];
    Rewards memory _rewards = rewards[account];
    return (
      _balances[account]
        .mul(rewardPerToken0.sub(_userRewardPerTokenPaid.token0))
        .div(1e18)
        .add(_rewards.token0),
      _balances[account]
        .mul(rewardPerToken1.sub(_userRewardPerTokenPaid.token1))
        .div(1e18)
        .add(_rewards.token1)
    );
  }

  function getRewardForDuration()
    external
    view
    override
    returns (uint256, uint256)
  {
    Rewards memory _rewardRate = rewardRate;
    return (
      uint256(_rewardRate.token0).mul(rewardsDuration),
      uint256(_rewardRate.token1).mul(rewardsDuration)
    );
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function stake(uint256 amount) external override {
    stakeFor(amount, msg.sender);
  }

  function stakeFor(uint256 amount, address account)
    public
    override
    nonReentrant
    notPaused
    updateReward(account)
  {
    require(amount > 0, "Cannot stake 0");
    _totalSupply = _totalSupply.add(amount);
    _balances[account] = _balances[account].add(amount);
    stakingToken.safeTransferFrom(msg.sender, address(this), amount);
    emit Staked(account, msg.sender, amount);
  }

  function withdraw(uint256 amount)
    public
    override
    nonReentrant
    updateReward(msg.sender)
  {
    require(amount > 0, "Cannot withdraw 0");
    _totalSupply = _totalSupply.sub(amount);
    _balances[msg.sender] = _balances[msg.sender].sub(amount);
    if (block.timestamp < periodFinish.add(1 days)) {
      rewards[msg.sender] = Rewards(0, 0);
    }
    stakingToken.safeTransfer(msg.sender, amount);
    emit Withdrawn(msg.sender, amount);
  }

  function getReward() public override nonReentrant updateReward(msg.sender) {
    Rewards memory _rewards = rewards[msg.sender];
    (uint256 reward0, uint256 reward1) = block.timestamp >=
      periodFinish.add(1 days)
      ? (_rewards.token0, _rewards.token1)
      : (0, 0);
    if (reward0 > 0) {
      rewards[msg.sender].token0 = 0;
      IERC20 _rewardsToken0 = rewardsToken0;
      _rewardsToken0.safeTransfer(
        msg.sender,
        Math.min(reward0, _rewardsToken0.balanceOf(address(this)))
      );
      emit RewardPaid(address(_rewardsToken0), msg.sender, reward0);
    }
    if (reward1 > 0) {
      rewards[msg.sender].token1 = 0;
      IERC20 _rewardsToken1 = rewardsToken1;
      _rewardsToken1.safeTransfer(
        msg.sender,
        Math.min(reward1, _rewardsToken1.balanceOf(address(this)))
      );
      emit RewardPaid(address(_rewardsToken1), msg.sender, reward1);
    }
  }

  function exit() external override {
    withdraw(_balances[msg.sender]);
    getReward();
  }

  function _numWeeksPassed(uint256 time) internal view returns (uint256) {
    if (time < startEmission) {
      return 0;
    }
    return time.sub(startEmission).div(1 weeks).add(1);
  }

  /* ========== RESTRICTED FUNCTIONS ========== */

  function notifyRewardAmount(uint256 reward0, uint256 reward1)
    external
    override
    onlyRewardsDistribution
    updateReward(address(0))
  {
    Rewards memory _rewardRate = rewardRate;
    if (block.timestamp >= periodFinish) {
      _rewardRate = Rewards(
        reward0.div(rewardsDuration).toUint128(),
        reward1.div(rewardsDuration).toUint128()
      );
    } else {
      uint256 remaining = periodFinish.sub(block.timestamp);
      _rewardRate = Rewards(
        reward0
          .add(remaining.mul(_rewardRate.token0))
          .div(rewardsDuration)
          .toUint128(),
        reward1
          .add(remaining.mul(_rewardRate.token1))
          .div(rewardsDuration)
          .toUint128()
      );
    }

    // Ensure the provided reward amount is not more than the balance in the contract.
    // This keeps the reward rate in the right range, preventing overflows due to
    // very high values of rewardRate in the earned and rewardsPerToken functions;
    // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
    IERC20 _rewardsToken0 = rewardsToken0;
    IERC20 _rewardsToken1 = rewardsToken1;
    require(
      _rewardRate.token0 <=
        _rewardsToken0.balanceOf(address(this)).div(rewardsDuration),
      "Provided reward0 too high"
    );
    require(
      _rewardRate.token1 <=
        _rewardsToken1.balanceOf(address(this)).div(rewardsDuration),
      "Provided reward1 too high"
    );

    rewardRate = _rewardRate;
    periodFinish = startEmission.add(rewardsDuration);
    lastUpdateTime = lastTimeRewardApplicable();
    emit RewardAdded(address(_rewardsToken0), reward0);
    emit RewardAdded(address(_rewardsToken1), reward1);
  }

  // Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders
  function recoverERC20(address tokenAddress, uint256 tokenAmount)
    external
    onlyOwner
  {
    require(
      tokenAddress != address(stakingToken),
      "Cannot withdraw the staking token"
    );
    IERC20(tokenAddress).safeTransfer(owner, tokenAmount);
    emit Recovered(tokenAddress, tokenAmount);
  }

  function setRewardsDuration(uint256 _rewardsDuration) external onlyOwner {
    require(
      block.timestamp > periodFinish,
      "Previous rewards period must be complete before changing the duration for the new period"
    );
    rewardsDuration = _rewardsDuration;
    emit RewardsDurationUpdated(rewardsDuration);
  }

  function setStartEmission(uint256 _startEmission) external onlyOwner {
    require(
      block.timestamp < _startEmission,
      "Start emission must be in the future"
    );
    startEmission = _startEmission;
    emit StartEmissionUpdated(startEmission);
  }

  /* ========== MODIFIERS ========== */

  modifier updateReward(address account) {
    (uint256 rewardPerToken0, uint256 rewardPerToken1) = rewardPerToken();
    Rewards memory _rewardPerTokenStored = Rewards(
      rewardPerToken0.toUint128(),
      rewardPerToken1.toUint128()
    );
    rewardPerTokenStored = _rewardPerTokenStored;
    lastUpdateTime = lastTimeRewardApplicable();
    if (account != address(0)) {
      (uint256 earned0, uint256 earned1) = earned(account);
      rewards[account] = Rewards(earned0.toUint128(), earned1.toUint128());
      userRewardPerTokenPaid[account] = _rewardPerTokenStored;
    }
    _;
  }

  /* ========== EVENTS ========== */

  event RewardAdded(address indexed token, uint256 reward);
  event Staked(address indexed user, address sender, uint256 amount);
  event Withdrawn(address indexed user, uint256 amount);
  event RewardPaid(address indexed token, address indexed user, uint256 reward);
  event RewardsDurationUpdated(uint256 newDuration);
  event StartEmissionUpdated(uint256 StartEmissionUpdated);
  event Recovered(address token, uint256 amount);
}
