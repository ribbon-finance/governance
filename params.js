const { ethers } = require("hardhat");
const { BigNumber } = ethers;

const isTest = process.env.CI;
const TEST_BENEFICIARY = "0x73BCEb1Cd57C711feaC4224D062b0F6ff338501e";
const DAO_MULTISIG = "0xDAEada3d210D2f45874724BeEa03C7d4BBD41674";
const beneficiary = isTest ? TEST_BENEFICIARY : DAO_MULTISIG;

// FOR MAINNET
const TOKEN_PARAMS = {
  NAME: "Ribbon",
  SYMBOL: "RBN",
  DECIMALS: "18",
  SUPPLY: BigNumber.from("1000000000")
    .mul(BigNumber.from("10").pow(BigNumber.from("18")))
    .toString(),
  BENIFICIARY: beneficiary,
};

// FOR MAINNET
const STAKING_REWARDS_rETHTHETA_PARAMS = {
  OWNER: beneficiary,
  REWARDS_DIST_ADDR: beneficiary,
  REWARDS_TOKEN: "",
  STAKING_TOKEN: "0x0FABaF48Bbf864a3947bdd0Ba9d764791a60467A",
  START_EMISSION: "",
};

// FOR MAINNET
const STAKING_REWARDS_rWBTCTHETA_PARAMS = {
  OWNER: beneficiary,
  REWARDS_DIST_ADDR: beneficiary,
  REWARDS_TOKEN: "",
  STAKING_TOKEN: "0x8b5876f5B0Bf64056A89Aa7e97511644758c3E8c",
  START_EMISSION: "",
};

// FOR MAINNET
const STAKING_REWARDS_rUSDCETHPTHETA_PARAMS = {
  OWNER: beneficiary,
  REWARDS_DIST_ADDR: beneficiary,
  REWARDS_TOKEN: "",
  STAKING_TOKEN: "0x16772a7f4a3ca291C21B8AcE76F9332dDFfbb5Ef",
  START_EMISSION: "",
};

// FOR MAINNET
const AIRDROP_PARAMS = {
  OWNER: beneficiary,
  TOKEN_ADDRESS: "",
  MERKLE_ROOT:
    "0x9795e2e7758a7cd25497d4da259bfd9dbf1c388cb685ca138ce10dc7dabab0a9",
  DAYS_UNTIL_UNLOCK: "200",
};

// FOR SCRIPT
const AIRDROP_SCRIPT_PARAMS = {
  STRANGLE_AMOUNT: BigNumber.from("500000").mul(
    BigNumber.from("10").pow(BigNumber.from("18"))
  ),
  VAULT_BASE_AMOUNT: BigNumber.from("10500000").mul(
    BigNumber.from("10").pow(BigNumber.from("18"))
  ),
  VAULT_EXTRA_AMOUNT: BigNumber.from("10000000").mul(
    BigNumber.from("10").pow(BigNumber.from("18"))
  ),
  EXTERNAL_PROTOCOLS_AMOUNT: BigNumber.from("4000000").mul(
    BigNumber.from("10").pow(BigNumber.from("18"))
  ),
  DISCORD_RHAT_AMOUNT: BigNumber.from("4000000").mul(
    BigNumber.from("10").pow(BigNumber.from("18"))
  ),
  DISCORD_NO_RHAT_AMOUNT: BigNumber.from("1000000").mul(
    BigNumber.from("10").pow(BigNumber.from("18"))
  ),
  BOXCOX_LAMBDA: 0.5,
};

// FOR TESTING
const STAKING_TOKEN_PARAMS = {
  ADDRESS: "0x0FABaF48Bbf864a3947bdd0Ba9d764791a60467A",
  MAIN_HOLDER: "0xB8A1eF5584564b0fDA3086Cc715B76de71DE21ED",
};

const EXTERNAL_TOKEN_PARAMS = {
  ADDRESS: "0xAd7Ca17e23f13982796D27d1E6406366Def6eE5f",
  MAIN_HOLDER: "0xc2C28f19d7a896fE2634392Fe732f716671c54EB",
};

module.exports = {
  TOKEN_PARAMS,
  AIRDROP_PARAMS,
  STAKING_REWARDS_rETHTHETA_PARAMS,
  STAKING_REWARDS_rWBTCTHETA_PARAMS,
  STAKING_REWARDS_rUSDCETHPTHETA_PARAMS,
  STAKING_TOKEN_PARAMS,
  EXTERNAL_TOKEN_PARAMS,
  AIRDROP_SCRIPT_PARAMS,
};
