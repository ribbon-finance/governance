const hre = require("hardhat");
const {
  MAIN_RIBBONOMICS_DIR,
  TEST_RIBBONOMICS_DIR,
  DAO_MULTISIG,
} = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;
const { getTimestamp } = require("../../test/utils/time");

async function main() {
  const [, deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const RewardsDistributorDelegate = await hre.ethers.getContractFactory(
    "RewardsDistributorDelegate",
    deployer
  );

  const rewardsDistributorDelegate = await RewardsDistributorDelegate.deploy();

  await rewardsDistributorDelegate.deployed();

  console.log(
    `\n RewardsDistributorDelegate contract is deployed at ${rewardsDistributorDelegate.address}, verify with https://etherscan.io/proxyContractChecker?a=${rewardsDistributorDelegate.address}\n`
  );

  await rewardsDistributorDelegate.deployTransaction.wait(5);

  const rewardToken = MAIN_RIBBONOMICS_DIR.TOKEN;
  const startTime =
    MAIN_RIBBONOMICS_DIR["FUSE_REWARDS_DISTRIBUTOR"]["START_TIME"];
  const rethThetaCtoken =
    MAIN_RIBBONOMICS_DIR["FUSE_REWARDS_DISTRIBUTOR"]["RETH_THETA_CTOKEN"];
  const usdcCtoken =
    MAIN_RIBBONOMICS_DIR["FUSE_REWARDS_DISTRIBUTOR"]["USDC_CTOKEN"];
  const rethThetaSupplierPCT =
    MAIN_RIBBONOMICS_DIR["FUSE_REWARDS_DISTRIBUTOR"]["RETH_THETA_SUPPLIER_PCT"];
  const usdcSupplierPCT =
    MAIN_RIBBONOMICS_DIR["FUSE_REWARDS_DISTRIBUTOR"]["USDC_SUPPLIER_PCT"];

  console.log("rewardToken", rewardToken);
  console.log("startTime", startTime);

  let tx = await rewardsDistributorDelegate.initialize(rewardToken, startTime);

  await tx.wait();

  let tx2 = await rewardsDistributorDelegate._setSupplierPCT(
    rethThetaCtoken,
    rethThetaSupplierPCT
  );

  await tx2.wait();

  let tx3 = await rewardsDistributorDelegate._addStable(usdcCtoken);

  await tx3.wait();

  let tx4 = await rewardsDistributorDelegate._setSupplierPCT(
    usdcCtoken,
    usdcSupplierPCT
  );

  await tx4.wait();

  await hre.run("verify:verify", {
    address: rewardsDistributorDelegate.address,
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
