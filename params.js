const { ethers } = require("hardhat");
const { BigNumber } = ethers;

const TOKEN_PARAMS = {
  NAME: "Ribbon",
  SYMBOL: "RBN",
  SUPPLY: BigNumber.from("1000000000")
    .mul(BigNumber.from("10").pow(BigNumber.from("18")))
    .toString(),
  OWNER: "0xb11D28B21001bA032Ada7C47032367C116cD566D",
};

module.exports = {
  TOKEN_PARAMS,
};
