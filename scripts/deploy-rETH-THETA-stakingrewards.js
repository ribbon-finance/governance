const hre = require("hardhat");
const { STAKING_REWARDS_rETHTHETA_PARAMS } = require("../params");
const moment = require("moment");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;

  /** We get the contract to deploy */
  const RibbonStakingRewards = await hre.ethers.getContractFactory(
    network === "kovan" ? "KovanStakingRewards" : "StakingRewards"
  );

  /** Set parameter */
  const owner =
    network === "kovan"
      ? deployer.address
      : STAKING_REWARDS_rETHTHETA_PARAMS.OWNER;
  const rewardsDistAddress =
    network === "kovan"
      ? deployer.address
      : STAKING_REWARDS_rETHTHETA_PARAMS.REWARDS_DIST_ADDR;
  /** Kovan will be $KRBN */
  const rewardsToken =
    network === "kovan"
      ? "0xfD55C3bB2d78d4FB67EB27807c9FD9B36F5ce592"
      : STAKING_REWARDS_rETHTHETA_PARAMS.REWARDS_TOKEN;
  const stakingToken =
    network === "kovan"
      ? "0x5B8E6eaB6502CC642d00A55F0d8B5f5557c94Bc5"
      : STAKING_REWARDS_rETHTHETA_PARAMS.STAKING_TOKEN;
  /**
   * Kovan will always start 1 minute from deployment
   */
  const startEmission =
    network === "kovan"
      ? moment().add(1, "minutes").unix()
      : STAKING_REWARDS_rETHTHETA_PARAMS.START_EMISSION;

  /** Deploy Address */
  const ribbonStakingRewards = await RibbonStakingRewards.deploy(
    owner,
    rewardsDistAddress,
    rewardsToken,
    stakingToken,
    startEmission
  );

  await ribbonStakingRewards.deployed();

  console.log(
    `\nRibbon rETH-THETA Staking Rewards is deployed at ${ribbonStakingRewards.address}, verify with https://etherscan.io/proxyContractChecker?a=${ribbonStakingRewards.address}\n`
  );

  await ribbonStakingRewards.deployTransaction.wait(5);

  await hre.run("verify:verify", {
    address: ribbonStakingRewards.address,
    constructorArguments: [
      owner,
      rewardsDistAddress,
      rewardsToken,
      stakingToken,
      startEmission,
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
