const hre = require("hardhat");
const { STAKING_REWARDS_rWBTCTHETA_PARAMS } = require("../params");
const moment = require("moment");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const RibbonStakingRewards = await hre.ethers.getContractFactory(
    "StakingRewards"
  );

  /** Set parameter */
  const owner =
    network === "kovan"
      ? deployer.address
      : STAKING_REWARDS_rWBTCTHETA_PARAMS.OWNER;
  const rewardsDistAddress =
    network === "kovan"
      ? deployer.address
      : STAKING_REWARDS_rWBTCTHETA_PARAMS.REWARDS_DIST_ADDR;
  /** Kovan will be $KRBN */
  const rewardsToken =
    network === "kovan"
      ? "0x567e482AF973187648Af9FC56d2Caec212c1CAca"
      : STAKING_REWARDS_rWBTCTHETA_PARAMS.REWARDS_TOKEN;
  const stakingToken =
    network === "kovan"
      ? "0xB0204738a785B2f788B55A4f7da2F74bB0a84245"
      : STAKING_REWARDS_rWBTCTHETA_PARAMS.STAKING_TOKEN;
  /**
   * Kovan will always be set to next saturday 1200 UTC
   */
  const startEmission =
    network === "kovan"
      ? moment()
          .startOf("isoWeek")
          .add(1, "week")
          .utc(true)
          .day("saturday")
          .unix()
      : STAKING_REWARDS_rETHTHETA_PARAMS.START_EMISSION;

  const ribbonStakingRewards = await RibbonStakingRewards.deploy(
    owner,
    rewardsDistAddress,
    rewardsToken,
    stakingToken,
    startEmission
  );

  await ribbonStakingRewards.deployed();

  console.log(
    `\nRibbon rWBTC-THETA Staking Rewards is deployed at ${ribbonStakingRewards.address}, verify with https://etherscan.io/proxyContractChecker?a=${ribbonStakingRewards.address}\n`
  );

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
