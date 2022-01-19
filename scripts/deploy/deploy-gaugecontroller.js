const hre = require("hardhat");
const { MAIN_RIBBONOMICS_DIR, TEST_RIBBONOMICS_DIR } = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;

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

  const admin = deployer.address
    //network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.O_ADMIN;

  console.log("token", token);
  console.log("voting_escrow", voting_escrow);
  console.log("veboost_proxy", veboost_proxy);
  console.log("admin", admin);

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

  await gaugeController.deployTransaction.wait(5);

  // add_type()

  const controller = await ethers.getContractAt(
    "GaugeController",
    gaugeController.address
  );

  const gauge_type =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.GAUGETYPE
      : MAIN_RIBBONOMICS_DIR.GAUGETYPE;

  await controller["add_type(string, uint256)"](gauge_type, BigNumber.from(10).pow(18)) // 10 ** 18 weight (100%)

  console.log(
    `\nAdded type ${gauge_type}\n`
  );

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
