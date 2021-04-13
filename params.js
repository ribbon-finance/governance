const { ethers } = require("hardhat");
const { BigNumber } = ethers;

const TOKEN_PARAMS = {
  NAME: "Ribbon",
  SYMBOL: "RBN",
  DECIMALS: "18",
  SUPPLY: BigNumber.from("1000000000")
    .mul(BigNumber.from("10").pow(BigNumber.from("18")))
    .toString(),
  OWNER: "0x73BCEb1Cd57C711feaC4224D062b0F6ff338501e",
};

module.exports = {
  TOKEN_PARAMS,
};
