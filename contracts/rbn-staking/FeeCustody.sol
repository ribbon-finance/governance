// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../interfaces/IFeeDistributor.sol";
import "../interfaces/IChainlink.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

/** @title FeeCustody
    @notice Custody Contract for Ribbon Vault Management / Performance Fees
 */

contract FeeCustody is Ownable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    // Distribution token for fee distributor: like RBN, USDC, ETH, etc
    IERC20 public distributionToken;
    // Protocol revenue recipient
    address public protocolRevenueRecipient;
    // Address of fee distributor contract for RBN lockers to claim
    IFeeDistributor public feeDistributor;

    // % allocation (0 - 100%) from protocol revenue to allocate to RBN lockers.
    // 2 decimals. ex: 10% = 1000
    uint256 public pctAllocationForRBNLockers;

    uint256 public constant TOTAL_PCT = 10000; // Equals 100%
    ISwapRouter public constant UNIV3_SWAP_ROUTER =
        ISwapRouter(0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45);

    // Intermediary path asset for univ3 swaps.
    // Empty if direct pool swap between asset and distribution asset
    mapping(address => bytes) public intermediaryPath;

    // Oracle between asset/usd pair for total
    // reward approximation across all assets earned
    mapping(address => address) public oracles;

    address[1000] assets;
    // Index of empty slot in assets array
    uint256 public lastAssetIdx;

    // Events
    event NewAsset(address asset, bytes intermediaryPath);
    event RecoveredAsset(address asset);
    event NewFeeDistributor(address feeDistributor);
    event NewRBNLockerAllocation(uint256 pctAllocationForRBNLockers);
    event NewDistributionToken(address distributionToken);
    event NewProtocolRevenueRecipient(address protocolRevenueRecipient);

    /**
     * @notice
     * Constructor
     * @param _pctAllocationForRBNLockers percent allocated for RBN lockers (100% = 10000)
     * @param _distributionToken asset to distribute to RBN lockers
     * @param _feeDistributor address of fee distributor where protocol revenue claimable
     * @param _protocolRevenueRecipient address of multisig
     * @param _admin admin
     */
    constructor(
        uint256 _pctAllocationForRBNLockers,
        address _distributionToken,
        address _feeDistributor,
        address _protocolRevenueRecipient,
        address _admin
    ) {
        require(_distributionToken != address(0), "!_distributionToken");
        require(_feeDistributor != address(0), "!_feeDistributor");
        require(_protocolRevenueRecipient != address(0), "!_protocolRevenueRecipient");
        require(_admin != address(0), "!_admin");

        pctAllocationForRBNLockers = _pctAllocationForRBNLockers;
        distributionToken = IERC20(_distributionToken);
        feeDistributor = IFeeDistributor(_feeDistributor);
        protocolRevenueRecipient = _protocolRevenueRecipient;

        _transferOwnership(_admin);
    }

    /**
     * @notice
     * Swaps RBN locker allocation of protocol revenu to distributionToken,
     * sends the rest to the multisig
     * @dev Can be called by admin
     * @param _minAmountOut min amount out for every asset type swap.
     * will need to be in order of assets in assets[] array. should be
     * fine if we keep track.
     * @param _deadline deadline for transaction expiry
     * @return toDistribute amount of distributionToken distributed to fee distributor
     */
    function distributeProtocolRevenue(
        uint256[] calldata _minAmountOut,
        uint256 _deadline
    ) external onlyOwner returns (uint256 toDistribute) {
        for (uint256 i; i < lastAssetIdx; i++) {
            IERC20 asset = IERC20(assets[i]);
            uint256 assetBalance = asset.balanceOf(address(this));

            if (assetBalance == 0) {
                continue;
            }

            uint256 multiSigRevenue = assetBalance
                .mul(TOTAL_PCT.sub(pctAllocationForRBNLockers))
                .div(TOTAL_PCT);

            // If we are holding the distributionToken itself,
            // do not swap
            if (address(asset) != address(distributionToken)) {
                // Calculate RBN allocation amount to swap for distributionToken
                uint256 amountIn = assetBalance.sub(multiSigRevenue);
                _swap(address(asset), amountIn, _minAmountOut[i], _deadline);
            }

            // Transfer multisig allocation of protocol revenue to multisig
            asset.transfer(protocolRevenueRecipient, multiSigRevenue);
        }

        toDistribute = distributionToken.balanceOf(address(this));
        distributionToken.safeApprove(address(feeDistributor), toDistribute);

        // Tranfer RBN locker allocation of protocol revenue to fee distributor
        feeDistributor.burn(address(distributionToken), toDistribute);
    }

    /**
     * @notice
     * Amount of _asset allocated to RBN lockers from current balance
     * @return amount allocated to RBN lockers
     */
    function claimableByRBNLockersOfAsset(address _asset)
        external
        view
        returns (uint256)
    {
        uint256 allocPCT = pctAllocationForRBNLockers;
        return
            IERC20(_asset).balanceOf(address(this)).mul(allocPCT).div(
                TOTAL_PCT
            );
    }

    /**
     * @notice
     * Amount of _asset allocated to multisig from current balance
     * @return amount allocated to multisig
     */
    function claimableByProtocolOfAsset(address _asset)
        external
        view
        returns (uint256)
    {
        uint256 allocPCT = TOTAL_PCT.sub(pctAllocationForRBNLockers);
        return
            IERC20(_asset).balanceOf(address(this)).mul(allocPCT).div(
                TOTAL_PCT
            );
    }

    /**
     * @notice
     * Total allocated to RBN lockers across all assets balances
     * @return total allocated (in USD)
     */
    function totalClaimableByRBNLockersInUSD() external view returns (uint256) {
        uint256 allocPCT = pctAllocationForRBNLockers;
        return _getSwapQuote(allocPCT);
    }

    /**
     * @notice
     * Total allocated to multisig across all assets balances
     * @return total allocated (in USD)
     */
    function totalClaimableByProtocolInUSD() external view returns (uint256) {
        uint256 allocPCT = TOTAL_PCT.sub(pctAllocationForRBNLockers);
        return _getSwapQuote(allocPCT);
    }

    /**
     * @notice
     * Total claimable across all asset balances based on allocation PCT
     * @param _allocPCT allocation percentage
     * @return claimable total claimable (in USD)
     */
    function _getSwapQuote(uint256 _allocPCT)
        internal
        view
        returns (uint256 claimable)
    {
        for (uint256 i; i < lastAssetIdx; i++) {
            IChainlink oracle = IChainlink(oracles[assets[i]]);

            // Approximate claimable by multiplying
            // current asset balance with current asset price in USD
            claimable += IERC20(assets[i])
                .balanceOf(address(this))
                .mul(oracle.latestAnswer())
                .mul(_allocPCT)
                .div(10 ** 8)
                .div(TOTAL_PCT);
        }
    }

    /**
     * @notice
     * Swaps _amountIn of _asset into distributionToken
     * @param _asset asset to swap from
     * @param _amountIn amount to swap of asset
     * @param _minAmountOut min amount out for every asset type swap
     * @param _deadline deadline for transaction expiry
     */
    function _swap(
        address _asset,
        uint256 _amountIn,
        uint256 _minAmountOut,
        uint256 _deadline
    ) internal {
        TransferHelper.safeApprove(
            _asset,
            address(UNIV3_SWAP_ROUTER),
            _amountIn
        );

        ISwapRouter.ExactInputParams memory params = ISwapRouter
            .ExactInputParams({
                path: intermediaryPath[_asset],
                recipient: msg.sender,
                deadline: _deadline,
                amountIn: _amountIn,
                amountOutMinimum: _minAmountOut
            });

        // Executes the swap.
        UNIV3_SWAP_ROUTER.exactInput(params);
    }

    /**
     * @notice
     * add asset
     * @dev Can be called by admin
     * @param _asset new asset
     * @param _oracle ASSET/USD ORACLE.
     * @param _intermediaryPath path for univ3 swap.
     * @param _poolFees fees for asset / distributionToken.

     * If intermediary path then pool fee between both pairs
     * (ex: AAVE / ETH , ETH / USDC)
     * NOTE: if intermediaryPath empty then single hop swap
     * NOTE: MUST BE ASSET / USD ORACLE
     * NOTE: 3000 = 0.3% fee for pool fees
     */
    function setAsset(
        address _asset,
        address _oracle,
        address[] calldata _intermediaryPath,
        address[] calldata _poolFees
    ) external onlyOwner {
        require(_asset != address(0), "!_asset");
        uint256 _pathLen = _intermediaryPath.length;
        uint256 _swapFeeLen = _poolFees.length;

        // We must be setting new valid oracle, or want to keep as is if one exists
        require(IChainlink(oracles[_asset]).decimals() == 8, "!ASSET/USD");
        require(_pathLen < 2, "invalid intermediary path");
        require(
            _swapFeeLen == _pathLen + 1,
            "invalid pool fees array length"
        );

        // If not set asset
        if (oracles[_asset] == address(0)) {
            assets[lastAssetIdx] = _asset;
            ++lastAssetIdx;
        }

        // Set oracle for asset
        oracles[_asset] = _oracle;

        // Multiple pool swaps are encoded through bytes called a `path`.
        // A path is a sequence of token addresses and poolFees that define the pools used in the swaps.
        // The format for pool encoding is (tokenIn, fee, tokenOut/tokenIn, fee, tokenOut)
        // where tokenIn/tokenOut parameter is the shared token across the pools.
        if (_pathLen > 0) {
            intermediaryPath[_asset] = abi.encodePacked(
                _asset,
                _poolFees[0],
                _intermediaryPath[0],
                _poolFees[1],
                address(distributionToken)
            );
        } else {
            intermediaryPath[_asset] = abi.encodePacked(
                _asset,
                _poolFees[0],
                address(distributionToken)
            );
        }

        emit NewAsset(_asset, intermediaryPath[_asset]);
    }

    /**
     * @notice
     * recover all assets
     * @dev Can be called by admin
     */
    function recoverAllAssets() external onlyOwner {
        // For all added assets, if not removed, send to protocol revenue recipient
        for (uint256 i = 0; i < lastAssetIdx; i++) {
            _recoverAsset(assets[i]);
        }
    }

    /**
     * @notice
     * recover specific asset
     * @dev Can be called by admin
     * @param _asset asset to recover
     */
    function recoverAsset(address _asset) external onlyOwner {
        require(_asset != address(0), "!asset");
        _recoverAsset(_asset);
    }

    /**
     * @notice
     * recovers asset logic
     * @param _asset asset to recover
     */
    function _recoverAsset(address _asset) internal {
        IERC20 asset = IERC20(_asset);
        uint256 bal = asset.balanceOf(address(this));
        if (bal > 0) {
            asset.transfer(protocolRevenueRecipient, bal);
            emit RecoveredAsset(_asset);
        }
    }

    /**
     * @notice
     * set fee distributor
     * @dev Can be called by admin
     * @param _feeDistributor new fee distributor
     */
    function setFeeDistributor(address _feeDistributor) external onlyOwner {
        require(_feeDistributor != address(0), "!_feeDistributor");
        feeDistributor = IFeeDistributor(_feeDistributor);
        emit NewFeeDistributor(_feeDistributor);
    }

    /**
     * @notice
     * set rbn locker allocation pct
     * @dev Can be called by admin
     * @param _pctAllocationForRBNLockers new allocation for rbn lockers
     */
    function setRBNLockerAllocPCT(uint256 _pctAllocationForRBNLockers)
        external
        onlyOwner
    {
        require(_pctAllocationForRBNLockers <= TOTAL_PCT, "!_pctAllocationForRBNLockers");
        pctAllocationForRBNLockers = _pctAllocationForRBNLockers;
        emit NewRBNLockerAllocation(_pctAllocationForRBNLockers);
    }

    /**
     * @notice
     * set new distribution asset
     * @dev Can be called by admin
     * @param _distributionToken new distribution token
     */
    function setDistributionToken(address _distributionToken)
        external
        onlyOwner
    {
        require(_distributionToken != address(0), "!_distributionToken");
        distributionToken = IERC20(_distributionToken);
        emit NewDistributionToken(_distributionToken);
    }

    /**
     * @notice
     * set protocol revenue recipient
     * @dev Can be called by admin
     * @param _protocolRevenueRecipient new protocol revenue recipient
     */
    function setProtocolRevenueRecipient(address _protocolRevenueRecipient)
        external
        onlyOwner
    {
        require(_protocolRevenueRecipient != address(0), "!_protocolRevenueRecipient");
        protocolRevenueRecipient = _protocolRevenueRecipient;
        emit NewProtocolRevenueRecipient(_protocolRevenueRecipient);
    }
}
