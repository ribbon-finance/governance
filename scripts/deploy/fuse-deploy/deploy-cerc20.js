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
  const CErc20 = await hre.ethers.getContractFactory("CErc20", deployer);

  const cERC20 = await CErc20.deploy();

  await cERC20.deployed();

  console.log(
    `\nCustom cERC20 contract is deployed at ${cERC20.address}, verify with https://etherscan.io/proxyContractChecker?a=${cERC20.address}\n`
  );

  await cERC20.deployTransaction.wait(5);

  const underlying = MAIN_RIBBONOMICS_DIR["LIQUIDITYGAUGES"]["ETH"];

  const comptroller = MAIN_RIBBONOMICS_DIR["FUSE"]["COMPTROLLER"];

  const interestRateModel = MAIN_RIBBONOMICS_DIR["FUSE"]["INTEREST_RATE_MODEL"];

  const name = MAIN_RIBBONOMICS_DIR["FUSE"]["UNDERLYING_NAME"];

  const symbol = MAIN_RIBBONOMICS_DIR["FUSE"]["UNDERLYING_SYMBOL"];

  const reserveFactorMantissa =
    MAIN_RIBBONOMICS_DIR["FUSE"]["RESERVE_FACTOR_MANTISSA"];

  const adminFeeMantissa = MAIN_RIBBONOMICS_DIR["FUSE"]["ADMIN_FEE_MANTISSA"];

  console.log("underlying", underlying);
  console.log("comptroller", comptroller);
  console.log("interestRateModel", interestRateModel);
  console.log("name", name);
  console.log("symbol", symbol);
  console.log("reserveFactorMantissa", reserveFactorMantissa);
  console.log("adminFeeMantissa", adminFeeMantissa);

  let tx = await cERC20.initialize(
    underyling,
    comptroller,
    interestRateModel,
    name,
    symbol,
    reserveFactorMantissa,
    adminFeeMantissa
  );

  await hre.run("verify:verify", {
    address: cERC20.address,
    constructorArguments: [],
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
