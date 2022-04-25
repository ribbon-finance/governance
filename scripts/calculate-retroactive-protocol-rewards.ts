const hre = require("hardhat");
const { DAO_MULTISIG } = require("../params");
const { ethers } = hre;
const { provider, BigNumber } = ethers;
import { currentTime, toUnit, fastForward } from "../test/utils";
import { network } from "hardhat";

let START_BLOCK = 14293476;
let END_BLOCK = 14650403;
let AMOUNT_FOR_GAMMA_UNIV3_SEED = BigNumber.from("180").mul(
  BigNumber.from(10).pow(18)
);

async function main() {
  let tokens = [
    "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", // wsteth
    "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // wbtc
    "0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE", // yvusdc
    "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", // aave
  ];
  let balancesBefore = [];
  let balancesAfter = [];

  for (var token of tokens) {
    const asset = await ethers.getContractAt("ERC20", token);
    let symbol = await asset.symbol();
    let bal = await asset.balanceOf(DAO_MULTISIG, { blockTag: START_BLOCK });
    balancesBefore.push([symbol, bal]);
  }

  balancesBefore.push([
    "ETH",
    (await provider.getBalance(DAO_MULTISIG, START_BLOCK)).sub(
      AMOUNT_FOR_GAMMA_UNIV3_SEED
    ),
  ]);

  for (var token of tokens) {
    const asset = await ethers.getContractAt("ERC20", token);
    let bal = await asset.balanceOf(DAO_MULTISIG, { blockTag: END_BLOCK });
    balancesAfter.push(bal);
  }

  balancesAfter.push(await provider.getBalance(DAO_MULTISIG, END_BLOCK));

  for (var i = 0; i < balancesBefore.length; i++) {
    console.log(
      `Balance in multisig in asset ${balancesBefore[i][0]} is ${balancesAfter[
        i
      ].sub(balancesBefore[i][1])}`
    );
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
