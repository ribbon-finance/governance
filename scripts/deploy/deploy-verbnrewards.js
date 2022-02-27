const hre = require("hardhat");
const { MAIN_RIBBONOMICS_DIR, TEST_RIBBONOMICS_DIR } = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;

async function main() {
  const [, deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const VeRBNRewards = await hre.ethers.getContractFactory(
    "VeRBNRewards",
    deployer
  );

  const votingEscrow =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.VOTINGESCROW
      : MAIN_RIBBONOMICS_DIR.VOTINGESCROW;

  const rewardToken =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.TOKEN
      : MAIN_RIBBONOMICS_DIR.TOKEN;

  const owner =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.O_ADMIN;

  console.log("votingEscrow", votingEscrow);
  console.log("rewardToken", rewardToken);
  console.log("gov", owner);

  const veRBNRewards = await VeRBNRewards.deploy(
    votingEscrow,
    rewardToken,
    owner
  );

  await veRBNRewards.deployed();

  console.log(
    `\nRibbon veRBN penalty contract is deployed at ${veRBNRewards.address}, verify with https://etherscan.io/proxyContractChecker?a=${veRBNRewards.address}\n`
  );

  await veRBNRewards.deployTransaction.wait(5);

  const votingEscrowContract = await ethers
    .getContractAt("VotingEscrow", votingEscrow)
    .connect(deployer);

  await votingEscrowContract["set_reward_pool(address)"](veRBNRewards.address);
  console.log("Reward pool in voting escrow set");

  await hre.run("verify:verify", {
    address: veRBNRewards.address,
    constructorArguments: [votingEscrow, rewardToken, owner],
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
