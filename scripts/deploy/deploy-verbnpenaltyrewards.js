const hre = require("hardhat");
const { MAIN_RIBBONOMICS_DIR, TEST_RIBBONOMICS_DIR } = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;
const { getTimestamp } = require("../../test/utils/time");
import { ZERO_ADDRESS } from "../../test/utils/constants";

import { readJSON } from '../get-historical-lockers.ts';

async function main() {
  const [, deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const PenaltyDistributor = await hre.ethers.getContractFactory(
    "PenaltyDistributor",
    deployer
  );

  const voting_escrow =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.VOTINGESCROW
      : MAIN_RIBBONOMICS_DIR.VOTINGESCROW;

  const start_time =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.PENALTYDISTRIBUTOR_START_TIME
      : MAIN_RIBBONOMICS_DIR.PENALTYDISTRIBUTOR_START_TIME;

  const token =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.TOKEN
      : MAIN_RIBBONOMICS_DIR.TOKEN;

  const penalty_rebate_expiry =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.PENALTY_REBATE_EXPIRY
      : MAIN_RIBBONOMICS_DIR.PENALTY_REBATE_EXPIRY;

  const rebate_addrs = readJSON().addresses;

  const rebates = readJSON().penaltyRebates;

  const o_admin =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.O_ADMIN;

  const e_admin =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.E_ADMIN;

  console.log("voting_escrow", voting_escrow);
  console.log("start_time", start_time.toString());
  console.log("penalty_rebate_expiry", penalty_rebate_expiry.toString());
  console.log("token", token);
  console.log("o_admin", o_admin);
  console.log("e_admin", e_admin);

  const penaltyDistributor = await PenaltyDistributor.deploy(
    voting_escrow,
    start_time,
    token,
    penalty_rebate_expiry,
    rebate_addrs,
    rebates,
    o_admin,
    e_admin
  );

  await penaltyDistributor.deployed();

  console.log(
    `\nRibbon penalty distributor contract is deployed at ${penaltyDistributor.address}, verify with https://etherscan.io/proxyContractChecker?a=${penaltyDistributor.address}\n`
  );

  await penaltyDistributor.deployTransaction.wait(5);

  await hre.run("verify:verify", {
    address: penaltyDistributor.address,
    constructorArguments: [voting_escrow, start_time, token, penalty_rebate_expiry, rebate_addrs, rebates, o_admin, e_admin],
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
