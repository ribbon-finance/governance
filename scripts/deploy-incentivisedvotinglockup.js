const hre = require("hardhat");
const { VOTINGLOCKUP_PARAMS, AIRDROP_PARAMS } = require("../params");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const IncentivisedVotingLockup = await hre.ethers.getContractFactory(
    "IncentivisedVotingLockup",
    deployer
  );

  const stakingToken =
    network === "kovan"
      ? "0x567e482AF973187648Af9FC56d2Caec212c1CAca"
      : AIRDROP_PARAMS.TOKEN_ADDRESS;

  const owner =
    network === "kovan" ? deployer.address : VOTINGLOCKUP_PARAMS.OWNER;

  const redeemer =
    network === "kovan"
      ? "0x4BD6AaA1461501b7B15a3a303d4a25d665C12f99"
      : VOTINGLOCKUP_PARAMS.REDEEMER;

  console.log("stakingToken", stakingToken);
  console.log("owner", owner);
  console.log("redeemer", redeemer);

  const incentivisedVotingLockup = await IncentivisedVotingLockup.deploy(
    stakingToken,
    owner,
    redeemer
  );

  await incentivisedVotingLockup.deployed();

  console.log(
    `\nRibbon voting lockup contract is deployed at ${incentivisedVotingLockup.address}, verify with https://etherscan.io/proxyContractChecker?a=${incentivisedVotingLockup.address}\n`
  );

  await incentivisedVotingLockup.deployTransaction.wait(5);

  await hre.run("verify:verify", {
    address: incentivisedVotingLockup.address,
    constructorArguments: [stakingToken, owner, redeemer],
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
