/* eslint-disable max-classes-per-file */
import { utils, BigNumber as BN } from "ethers";

require("dotenv").config();

/**
 * @notice This file contains constants relevant across the mStable test suite
 * Wherever possible, it should conform to fixed on chain vars
 */

export const ratioScale = BN.from(10).pow(8);
export const fullScale: BN = BN.from(10).pow(18);

export const DEFAULT_DECIMALS = 18;

export const DEAD_ADDRESS = "0x0000000000000000000000000000000000000001";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export const MAX_UINT256 = BN.from(2).pow(256).sub(1);
export const MAX_INT128 = BN.from(2).pow(127).sub(1);
export const MIN_INT128 = BN.from(2).pow(127).mul(-1);

export const ZERO = BN.from(0);
export const ONE_MIN = BN.from(60);
export const TEN_MINS = BN.from(60 * 10);
export const ONE_HOUR = BN.from(60 * 60);
export const ONE_DAY = BN.from(60 * 60 * 24);
export const FIVE_DAYS = BN.from(60 * 60 * 24 * 5);
export const TEN_DAYS = BN.from(60 * 60 * 24 * 10);
export const ONE_WEEK = BN.from(60 * 60 * 24 * 7);
export const ONE_YEAR = BN.from(60 * 60 * 24 * 365);

export const TEST_URI = process.env.TEST_URI;

/**
 * Assets
 */
export const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export const WETH_ADDRESS = "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0";
export const WBTC_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
export const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const AAVE_ADDRESS = "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9";

export const WETH_OWNER_ADDRESS = "0x2feb1512183545f48f6b9c5b4ebfcaf49cfca6f3";
export const WSTETH_OWNER_ADDRESS =
  "0x27edc7700f1820cb38ec3bbb84c542945f21b5a1";
export const WBTC_OWNER_ADDRESS = "0x7abe0ce388281d2acf297cb089caef3819b13448";
export const USDC_OWNER_ADDRESS = "0xe11970f2f3de9d637fb786f2d869f8fea44195ac";
export const AAVE_OWNER_ADDRESS = "0x69a8ff64ed164ed3d757831d425fdbe904186108";

/**
 * Chainlink Oracles
 *
 * https://data.chain.link/
 * https://docs.chain.link/docs/avalanche-price-feeds
 */

export const ETH_PRICE_ORACLE = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
export const BTC_PRICE_ORACLE = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
export const USDC_PRICE_ORACLE = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
export const AAVE_PRICE_ORACLE = "0x547a514d5e3769680ce22b2361c10ea13619e8a9";
export const BAD_PRICE_ORACLE = "0x6df09e975c830ecae5bd4ed9d90f3a95a4f88012";

/**
 * DEX Routers and Factories
 */

export const DEX_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
export const DEX_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

/**
 * Swap Pools
 */

export const ETH_USDC_POOL = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";
export const ETH_BTC_POOL = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";
export const ETH_BTC_POOL_S = "0x4585fe77225b41b697c938b018e2ac67ac5a20c0";
export const BTC_USDC_POOL = "0x99ac8ca7087fa4a2a1fb6357269965a2014abc35";
export const ETH_AAVE_POOL = "0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb";

export const POOL_LARGE_FEE = 3000;
export const POOL_SMALL_FEE = 500;

export const PCT_AllOC_FOR_LOCKERS = 5000; // 50%
