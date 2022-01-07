const hre = require("hardhat");
const { MAIN_RIBBONOMICS_DIR, TEST_RIBBONOMICS_DIR } = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;
const { getTimestamp } = require("test/utils/time");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const GaugeController = await hre.ethers.getContractFactory(
    "GaugeController",
    deployer
  );

  const token =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.TOKEN
      : MAIN_RIBBONOMICS_DIR.TOKEN;

  const voting_escrow =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.VOTINGESCROW
      : MAIN_RIBBONOMICS_DIR.VOTINGESCROW;

  const veboost_proxy =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.VEBOOSTPROXY
      : MAIN_RIBBONOMICS_DIR.VEBOOSTPROXY;

  const admin =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.O_ADMIN;

  console.log("token", token);
  console.log("voting_escrow", voting_escrow);
  console.log("veboost_proxy", veboost_proxy);
  console.log("o_admin", o_admin);

  const gaugeController = await GaugeController.deploy(
    token,
    voting_escrow,
    veboost_proxy,
    admin,
  );

  await gaugeController.deployed();

  console.log(
    `\nRibbon gauge controller contract is deployed at ${gaugeController.address}, verify with https://etherscan.io/proxyContractChecker?a=${gaugeController.address}\n`
  );

  await feeDistributor.deployTransaction.wait(5);

  await hre.run("verify:verify", {
    address: gaugeController.address,
    constructorArguments: [token, voting_escrow, veboost_proxy, admin],
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
