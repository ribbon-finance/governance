const hre = require("hardhat");
const { MAIN_RIBBONOMICS_DIR, TEST_RIBBONOMICS_DIR } = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;

async function main() {
  const [, deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const Minter = await hre.ethers.getContractFactory("Minter", deployer);

  const token =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.TOKEN
      : MAIN_RIBBONOMICS_DIR.TOKEN;

  const gauge_controller =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.GAUGECONTROLLER
      : MAIN_RIBBONOMICS_DIR.GAUGECONTROLLER;

  const o_admin =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.O_ADMIN;

  const e_admin =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.E_ADMIN;

  console.log("token", token);
  console.log("gauge_controller", gauge_controller);
  console.log("o_admin", o_admin);
  console.log("e_admin", e_admin);

  const minter = await Minter.deploy(token, gauge_controller, e_admin, o_admin);

  await minter.deployed();

  console.log(
    `\nRibbon minter contract is deployed at ${minter.address}, verify with https://etherscan.io/proxyContractChecker?a=${minter.address}\n`
  );

  await minter.deployTransaction.wait(5);

  await hre.run("verify:verify", {
    address: minter.address,
    constructorArguments: [token, gauge_controller, e_admin, o_admin],
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
