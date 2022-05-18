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
import {DSMath} from "../common/DSMath.sol";

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
    USD
  }

  /**
   * @notice Chainlink ETH/USD price feed contracts.
   */
  IAggregatorV3Interface public constant ETH_USD_PRICE_FEED =
    IAggregatorV3Interface(0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419);

  /**
   * @notice Chainlink ETH/ETH price feed.
   */
  address public constant ETH_ETH_PRICE_FEED = address(1);

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
  constructor(address _admin, bool _canAdminOverwrite) public {
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
  modifier onlyAdmin() {
    require(msg.sender == admin, "Sender is not the admin.");
    _;
  }

  /**
   * @dev Admin-only function to set price feeds.
   * @param underlyings Underlying token addresses for which to set price feeds. (gauge token)
   * @param feeds The Chainlink price feed contract addresses for each of `underlyings`. (underlying of gauge's vault token)
   * @param baseCurrency The currency in which `feeds` are based.
   */
  function setPriceFeeds(
    address[] calldata underlyings,
    IAggregatorV3Interface[] calldata feeds,
    FeedBaseCurrency baseCurrency
  ) external onlyAdmin {
    // Input validation
    require(
      underlyings.length > 0 && underlyings.length == feeds.length,
      "Lengths of both arrays must be equal and greater than 0."
    );

    // For each token/feed
    for (uint256 i = 0; i < underlyings.length; i++) {
      address underlying = underlyings[i];

      // Check for existing oracle if !canAdminOverwrite
      if (!canAdminOverwrite)
        require(
          address(priceFeeds[underlying]) == address(0),
          "Admin cannot overwrite existing assignments of price feeds to underlying tokens."
        );

      // Set feed and base currency
      priceFeeds[underlying] = feeds[i];
      feedBaseCurrencies[underlying] = baseCurrency;
    }
  }

  /**
   * @dev Internal function returning the price in ETH of `underlying`.
   */
  function _price(address underlying) internal view returns (uint256) {
    // Get token/ETH price from Chainlink
    IAggregatorV3Interface feed = priceFeeds[underlying];
    require(
      address(feed) != address(0),
      "No Chainlink price feed found for this underlying ERC20 token."
    );
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
      // If ETH or stETH vault gauge
      if (address(feed) == ETH_ETH_PRICE_FEED) {
        return rVaultToAssetExchangeRate;
      }

      int256 tokenEthPrice = _feedPrice(feed);

      return
        tokenEthPrice >= 0
          ? DSMath.wmul(
            uint256(tokenEthPrice),
            rVaultToAssetExchangeRate.mul(10**(18 - rVaultDecimals))
          )
          : 0;
    } else if (baseCurrency == FeedBaseCurrency.USD) {
      int256 ethUsdPrice = _feedPrice(ETH_USD_PRICE_FEED);
      if (ethUsdPrice <= 0) return 0;
      int256 tokenUsdPrice = _feedPrice(feed);
      if (tokenUsdPrice <= 0) return 0;

      uint256 tokenUsdPriceInAsset = DSMath.wmul(
        uint256(tokenUsdPrice).mul(10**(18 - feed.decimals())),
        rVaultToAssetExchangeRate.mul(10**(18 - rVaultDecimals))
      );
      return tokenUsdPriceInAsset.mul(10**8).div(uint256(ethUsdPrice));
    }

    return 0;
  }

  /**
   * @dev Returns the chainlink oracle price from the feed
   */
  function _feedPrice(IAggregatorV3Interface feed)
    internal
    view
    returns (int256)
  {
    (
      uint80 roundID,
      int256 price,
      ,
      uint256 timeStamp,
      uint80 answeredInRound
    ) = feed.latestRoundData();

    require(answeredInRound >= roundID, "Stale oracle price");
    require(timeStamp != 0, "!timeStamp");
    return price;
  }

  /**
   * @dev Returns the price in ETH of `underlying` (implements `BasePriceOracle`).
   */
  function price(address underlying) external view override returns (uint256) {
    return _price(underlying);
  }

  /**
   * @notice Returns the price in ETH of the token underlying `cToken`.
   * @dev Implements the `PriceOracle` interface for Fuse pools (and Compound v2).
   * @return Price in ETH of the token underlying `cToken`, scaled by `10 ** (36 - underlyingDecimals)`.
   */
  function getUnderlyingPrice(ICToken cToken)
    external
    view
    override
    returns (uint256)
  {
    // Return 1e18 for ETH
    if (cToken.isCEther()) return 1e18;

    // Get underlying token address
    address underlying = ICErc20(address(cToken)).underlying();

    // Get price
    uint256 chainlinkPrice = _price(underlying);

    // Format and return price
    uint256 underlyingDecimals = uint256(
      ERC20Upgradeable(underlying).decimals()
    );
    return
      underlyingDecimals <= 18
        ? uint256(chainlinkPrice).mul(10**(18 - underlyingDecimals))
        : uint256(chainlinkPrice).div(10**(underlyingDecimals - 18));
  }
}
