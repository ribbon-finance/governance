const hre = require("hardhat");
const { STAKING_REWARDS_rUSDCETHPTHETA_PARAMS } = require("../params");

async function main() {
  // We get the contract to deploy
  const RibbonStakingRewards = await hre.ethers.getContractFactory(
    "StakingRewards"
  );
  const ribbonStakingRewards = await RibbonStakingRewards.deploy(
    STAKING_REWARDS_rUSDCETHPTHETA_PARAMS.OWNER,
    STAKING_REWARDS_rUSDCETHPTHETA_PARAMS.REWARDS_DIST_ADDR,
    STAKING_REWARDS_rUSDCETHPTHETA_PARAMS.REWARDS_TOKEN,
    STAKING_REWARDS_rUSDCETHPTHETA_PARAMS.STAKING_TOKEN,
    STAKING_REWARDS_rUSDCETHPTHETA_PARAMS.START_EMISSION
  );

  await ribbonStakingRewards.deployed();

  console.log(
    `\nRibbon rUSDCETH-THETA Staking Rewards is deployed at ${ribbonStakingRewards.address}, verify with https://etherscan.io/proxyContractChecker?a=${ribbonStakingRewards.address}\n`
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
