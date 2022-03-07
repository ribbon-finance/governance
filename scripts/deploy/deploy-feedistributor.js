const hre = require("hardhat");
const { MAIN_RIBBONOMICS_DIR, TEST_RIBBONOMICS_DIR } = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;
const { getTimestamp } = require("../../test/utils/time");

async function main() {
  const [, deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const FeeDistributor = await hre.ethers.getContractFactory(
    "FeeDistributor",
    deployer
  );

  const voting_escrow =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.VOTINGESCROW
      : MAIN_RIBBONOMICS_DIR.VOTINGESCROW;

  const verbn_rewards =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.VERBNREWARDS
      : MAIN_RIBBONOMICS_DIR.VERBNREWARDS;

  const start_time = await getTimestamp();

  const token =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.TOKEN
      : MAIN_RIBBONOMICS_DIR.TOKEN;

  const o_admin =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.O_ADMIN;

  const e_admin =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.E_ADMIN;

  console.log("voting_escrow", voting_escrow);
  console.log("verbn_rewards", verbn_rewards);
  console.log("start_time", start_time.toString());
  console.log("token", token);
  console.log("o_admin", o_admin);
  console.log("e_admin", e_admin);

  const feeDistributor = await FeeDistributor.deploy(
    voting_escrow,
    verbn_rewards,
    start_time,
    token,
    o_admin,
    e_admin
  );

  await feeDistributor.deployed();

  console.log(
    `\nRibbon fee distributor contract is deployed at ${feeDistributor.address}, verify with https://etherscan.io/proxyContractChecker?a=${feeDistributor.address}\n`
  );

  await feeDistributor.deployTransaction.wait(5);

  const veRBNRewards = await ethers.getContractAt(
    "VeRBNRewards",
    verbn_rewards
  );

  await veRBNRewards.addToWhitelist(feeDistributor.address, true);
  console.log("Added fee distributor to veRBN Rewards whitelist!");

  await hre.run("verify:verify", {
    address: feeDistributor.address,
    constructorArguments: [
      voting_escrow,
      verbn_rewards,
      start_time,
      token,
      o_admin,
      e_admin,
    ],
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
