const hre = require("hardhat");
const {
  MAIN_RIBBONOMICS_DIR,
  TEST_RIBBONOMICS_DIR,
  DAO_MULTISIG,
} = require("../../../params");
const { ethers } = hre;
const { BigNumber } = ethers;

async function main() {
  const [, deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const CErc20Delegate = await hre.ethers.getContractFactory(
    "CErc20Delegate",
    deployer
  );

  const cErc20Delegate = await CErc20Delegate.deploy();

  await cErc20Delegate.deployed();

  console.log(
    `\nCustom cErc20Delegate contract is deployed at ${cErc20Delegate.address}, verify with https://etherscan.io/proxyContractChecker?a=${cErc20Delegate.address}\n`
  );

  await cErc20Delegate.deployTransaction.wait(5);

  let tx = await cErc20Delegate.initialize();

  await hre.run("verify:verify", {
    address: cErc20Delegate.address,
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
