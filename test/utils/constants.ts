/* eslint-disable max-classes-per-file */
import { utils, BigNumber as BN } from "ethers"

/**
 * @notice This file contains constants relevant across the mStable test suite
 * Wherever possible, it should conform to fixed on chain vars
 */

export const ratioScale = BN.from(10).pow(8)
export const fullScale: BN = BN.from(10).pow(18)

export const DEFAULT_DECIMALS = 18

export const DEAD_ADDRESS = "0x0000000000000000000000000000000000000001"
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
export const ZERO_KEY = "0x0000000000000000000000000000000000000000000000000000000000000000"

export const MAX_UINT256 = BN.from(2).pow(256).sub(1)
export const MAX_INT128 = BN.from(2).pow(127).sub(1)
export const MIN_INT128 = BN.from(2).pow(127).mul(-1)

export const ZERO = BN.from(0)
export const ONE_MIN = BN.from(60)
export const TEN_MINS = BN.from(60 * 10)
export const ONE_HOUR = BN.from(60 * 60)
export const ONE_DAY = BN.from(60 * 60 * 24)
export const FIVE_DAYS = BN.from(60 * 60 * 24 * 5)
export const TEN_DAYS = BN.from(60 * 60 * 24 * 10)
export const ONE_WEEK = BN.from(60 * 60 * 24 * 7)
export const ONE_YEAR = BN.from(60 * 60 * 24 * 365)

export const RBN = "0x6123b0049f904d730db3c36a31167d9d4121fa6b"
export const RBN_OWNER_ADDRESS = "0xB4B7DD60011B76a20cB348EA9681595babF793BA"
export const RSTETH_THETA_GAUGE = "0x4e079dCA26A4fE2586928c1319b20b1bf9f9be72"
export const RSTETH_THETA_GAUGE_OWNER_ADDRESS = "0x8f688a91695f7d2a1e93e57cedcbf5c5202f617b"
export const RBN_MINTER = "0x5B0655F938A72052c46d2e94D206ccB6FF625A3A"
export const BORROWER_PCT = 5000
