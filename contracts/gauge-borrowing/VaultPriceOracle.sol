// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "../interfaces/Compound/IPriceOracle.sol";
import "../interfaces/Compound/IBasePriceOracle.sol";
import "../interfaces/Compound/ICToken.sol";
import "../interfaces/Compound/ICErc20.sol";
import "../interfaces/Compound/IAggregatorV3Interface.sol";
import "../interfaces/Compound/ILiquidityGauge.sol";
import "../interfaces/Compound/IRibbonVault.sol";

/**
 * @title VaultPriceOracle
 * @notice Returns prices from Chainlink.
 * @dev Implements `PriceOracle`.
 * @author David Lucid <david@rari.capital> (https://github.com/davidlucid)
 */
contract VaultPriceOracle is IPriceOracle, IBasePriceOracle {
    using SafeMathUpgradeable for uint256;

    /**
     * @notice Maps ERC20 token addresses to ETH-based Chainlink price feed contracts.
     */
    mapping(address => IAggregatorV3Interface) public priceFeeds;

    /**
     * @notice Maps ERC20 token addresses to enums indicating the base currency of the feed.
     */
    mapping(address => FeedBaseCurrency) public feedBaseCurrencies;

    /**
     * @notice Enum indicating the base currency of a Chainlink price feed.
     */
    enum FeedBaseCurrency {
        ETH,
        USD,
        BTC
    }

    /**
     * @notice Chainlink ETH/USD price feed contracts.
     */
    IAggregatorV3Interface public constant ETH_USD_PRICE_FEED = IAggregatorV3Interface(0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419);

    /**
     * @notice Chainlink BTC/ETH price feed contracts.
     */
    IAggregatorV3Interface public constant BTC_ETH_PRICE_FEED = IAggregatorV3Interface(0xdeb288F737066589598e9214E782fa5A8eD689e8);

    /**
     * @dev The administrator of this `MasterPriceOracle`.
     */
    address public admin;

    /**
     * @dev Controls if `admin` can overwrite existing assignments of oracles to underlying tokens.
     */
    bool public canAdminOverwrite;

    /**
     * @dev Constructor to set admin and canAdminOverwrite.
     */
    constructor (address _admin, bool _canAdminOverwrite) public {
        admin = _admin;
        canAdminOverwrite = _canAdminOverwrite;
    }

    /**
     * @dev Changes the admin and emits an event.
     */
    function changeAdmin(address newAdmin) external onlyAdmin {
        address oldAdmin = admin;
        admin = newAdmin;
        emit NewAdmin(oldAdmin, newAdmin);
    }

    /**
     * @dev Event emitted when `admin` is changed.
     */
    event NewAdmin(address oldAdmin, address newAdmin);

    /**
     * @dev Modifier that checks if `msg.sender == admin`.
     */
    modifier onlyAdmin {
        require(msg.sender == admin, "Sender is not the admin.");
        _;
    }

    /**
     * @dev Admin-only function to set price feeds.
     * @param underlyings Underlying token addresses for which to set price feeds. (gauge token)
     * @param feeds The Chainlink price feed contract addresses for each of `underlyings`. (underlying of gauge's vault token)
     * @param baseCurrency The currency in which `feeds` are based.
     */
    function setPriceFeeds(address[] memory underlyings, IAggregatorV3Interface[] memory feeds, FeedBaseCurrency baseCurrency) external onlyAdmin {
        // Input validation
        require(underlyings.length > 0 && underlyings.length == feeds.length, "Lengths of both arrays must be equal and greater than 0.");

        // For each token/feed
        for (uint256 i = 0; i < underlyings.length; i++) {
            address underlying = underlyings[i];

            // Check for existing oracle if !canAdminOverwrite
            if (!canAdminOverwrite) require(address(priceFeeds[underlying]) == address(0), "Admin cannot overwrite existing assignments of price feeds to underlying tokens.");

            // Set feed and base currency
            priceFeeds[underlying] = feeds[i];
            feedBaseCurrencies[underlying] = baseCurrency;
        }
    }

    /**
     * @dev Internal function returning the price in ETH of `underlying`.
     */
    function _price(address underlying) internal view returns (uint) {
        // Return 1e18 for WETH
        if (underlying == 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2) return 1e18;

        // Get token/ETH price from Chainlink
        IAggregatorV3Interface feed = priceFeeds[underlying];
        require(address(feed) != address(0), "No Chainlink price feed found for this underlying ERC20 token.");
        FeedBaseCurrency baseCurrency = feedBaseCurrencies[underlying];

        IRibbonVault vault = IRibbonVault(ILiquidityGauge(underlying).lp_token());
        uint256 rVaultDecimals = vault.decimals();
        uint256 rVaultToAssetExchangeRate = vault.pricePerShare(); // (ex: rETH-THETA -> ETH, rBTC-THETA -> BTC)

        // underlying = rETH-THETA-gauge
        // vault = rETH-THETA
        // feed = ETH (underlying asset of vault rETH-THETA)
        // underlying price = feed * (vault token to asset of vault exchange rate)

        // rETH-THETA-gauge -> rETH-THETA -> ETH

        if (baseCurrency == FeedBaseCurrency.ETH) {
            (, int256 tokenEthPrice, , , ) = feed.latestRoundData();
            return tokenEthPrice >= 0 ? uint256(tokenEthPrice).mul(rVaultToAssetExchangeRate).div(rVaultDecimals) : 0;
        } else if (baseCurrency == FeedBaseCurrency.USD) {
            (, int256 ethUsdPrice, , , ) = ETH_USD_PRICE_FEED.latestRoundData();
            if (ethUsdPrice <= 0) return 0;
            (, int256 tokenUsdPrice, , , ) = feed.latestRoundData();
            if (tokenUsdPrice < 0) return 0;
            uint256 tokenUsdPriceInAsset = uint256(tokenUsdPrice).mul(rVaultToAssetExchangeRate).div(rVaultDecimals);
            return tokenUsdPriceInAsset.mul(1e18).div(uint256(ethUsdPrice));
        } else if (baseCurrency == FeedBaseCurrency.BTC) {
            (, int256 btcEthPrice, , , ) = BTC_ETH_PRICE_FEED.latestRoundData();
            if (btcEthPrice <= 0) return 0;
            (, int256 tokenBtcPrice, , , ) = feed.latestRoundData();
            if (tokenBtcPrice < 0) return 0;
            uint256 tokenBtcPriceInAsset = uint256(tokenBtcPrice).mul(rVaultToAssetExchangeRate).div(rVaultDecimals);
            return tokenBtcPriceInAsset.mul(uint256(btcEthPrice)).div(1e8);
        }
    }

    /**
     * @dev Returns the price in ETH of `underlying` (implements `BasePriceOracle`).
     */
    function price(address underlying) external override view returns (uint) {
        return _price(underlying);
    }

    /**
     * @notice Returns the price in ETH of the token underlying `cToken`.
     * @dev Implements the `PriceOracle` interface for Fuse pools (and Compound v2).
     * @return Price in ETH of the token underlying `cToken`, scaled by `10 ** (36 - underlyingDecimals)`.
     */
    function getUnderlyingPrice(ICToken cToken) external override view returns (uint) {
        // Return 1e18 for ETH
        if (cToken.isCEther()) return 1e18;

        // Get underlying token address
        address underlying = ICErc20(address(cToken)).underlying();

        // Get price
        uint256 chainlinkPrice = _price(underlying);

        // Format and return price
        uint256 underlyingDecimals = uint256(ERC20Upgradeable(underlying).decimals());
        return underlyingDecimals <= 18 ? uint256(chainlinkPrice).mul(10 ** (18 - underlyingDecimals)) : uint256(chainlinkPrice).div(10 ** (underlyingDecimals - 18));
    }
}
