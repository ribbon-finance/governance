const { ethers } = require("hardhat");
const { BigNumber } = ethers;

// FOR MAINNET
const TOKEN_PARAMS = {
  NAME: "Ribbon",
  SYMBOL: "RBN",
  DECIMALS: "18",
  SUPPLY: BigNumber.from("1000000000")
    .mul(BigNumber.from("10").pow(BigNumber.from("18")))
    .toString(),
  BENIFICIARY: "0x73BCEb1Cd57C711feaC4224D062b0F6ff338501e",
};

// FOR MAINNET
const STAKING_REWARDS_rETHTHETA_PARAMS = {
  OWNER: "0x73BCEb1Cd57C711feaC4224D062b0F6ff338501e",
  REWARDS_DIST_ADDR: "0x73BCEb1Cd57C711feaC4224D062b0F6ff338501e",
  REWARDS_TOKEN: "",
  STAKING_TOKEN: "0x0FABaF48Bbf864a3947bdd0Ba9d764791a60467A",
  START_EMISSION: "",
};

// FOR MAINNET
const STAKING_REWARDS_rWBTCTHETA_PARAMS = {
  OWNER: "0x73BCEb1Cd57C711feaC4224D062b0F6ff338501e",
  REWARDS_DIST_ADDR: "0x73BCEb1Cd57C711feaC4224D062b0F6ff338501e",
  REWARDS_TOKEN: "",
  STAKING_TOKEN: "",
  START_EMISSION: "",
};

// FOR MAINNET
const AIRDROP_PARAMS = {
  STRANGLE_AMOUNT: BigNumber.from("2000000")
    .mul(BigNumber.from("10").pow(BigNumber.from("18")))
    .toString(),
  VAULT_BASE_AMOUNT: BigNumber.from("8000000")
    .mul(BigNumber.from("10").pow(BigNumber.from("18")))
    .toString(),
  VAULT_EXTRA_AMOUNT: BigNumber.from("4000000")
    .mul(BigNumber.from("10").pow(BigNumber.from("18")))
    .toString(),
  EXTERNAL_PROTOCOLS_AMOUNT: BigNumber.from("6000000")
    .mul(BigNumber.from("10").pow(BigNumber.from("18")))
    .toString(),
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
  STAKING_REWARDS_rETHTHETA_PARAMS,
  STAKING_REWARDS_rWBTCTHETA_PARAMS,
  STAKING_TOKEN_PARAMS,
  EXTERNAL_TOKEN_PARAMS,
};
