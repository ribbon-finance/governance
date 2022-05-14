const hre = require("hardhat");
const {
  MAIN_RIBBONOMICS_DIR,
  TEST_RIBBONOMICS_DIR,
  DAO_MULTISIG,
} = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;

async function main() {
  const [, deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const VaultPriceOracle = await hre.ethers.getContractFactory(
    "VaultPriceOracle",
    deployer
  );

  const admin = network === "kovan" ? deployer.address : deployer.address;

  const canAdminOverwrite =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.CAN_ADMIN_OVERWRITE_ORACLE_FEED
      : MAIN_RIBBONOMICS_DIR.CAN_ADMIN_OVERWRITE_ORACLE_FEED;

  console.log("admin", admin);
  console.log("canAdminOverwrite", canAdminOverwrite);

  const vaultPriceOracle = await VaultPriceOracle.deploy(
    admin,
    canAdminOverwrite
  );

  await vaultPriceOracle.deployed();

  console.log(
    `\nRibbon vault price oracle contract is deployed at ${vaultPriceOracle.address}, verify with https://etherscan.io/proxyContractChecker?a=${vaultPriceOracle.address}\n`
  );

  await vaultPriceOracle.deployTransaction.wait(5);

  const underlying =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR["LIQUIDITYGAUGES"]["ETH"]
      : MAIN_RIBBONOMICS_DIR["LIQUIDITYGAUGES"]["ETH"];

  const feed = await vaultPriceOracle.ETH_ETH_PRICE_FEED();

  const baseCurrency = 1;

  let tx = await vaultPriceOracle.setPriceFeeds(
    [underlying],
    [feed],
    baseCurrency
  );

  await tx.wait();

  const admin =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.O_ADMIN
      : MAIN_RIBBONOMICS_DIR.O_ADMIN;

  let tx2 = await vaultPriceOracle.changeAdmin(admin);

  await hre.run("verify:verify", {
    address: vaultPriceOracle.address,
    constructorArguments: [admin, canAdminOverwrite],
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
