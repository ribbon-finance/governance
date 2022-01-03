const hre = require("hardhat");
const { VOTINGLOCKUP_PARAMS, AIRDROP_PARAMS } = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const VotingEscrow = await hre.ethers.getContractFactory(
    "VotingEscrow",
    deployer
  );

  const stakingToken =
    network === "kovan"
      ? "0x80ba81056ba048c82b7b01eb8bffe342fde1998d"
      : AIRDROP_PARAMS.TOKEN_ADDRESS;

  const name = "Vote-escrowed RBN"

  const symbol = "veRBN"

  const owner =
    network === "kovan" ? deployer.address : VOTINGLOCKUP_PARAMS.OWNER;

  console.log("stakingToken", stakingToken);
  console.log("name", name);
  console.log("symbol", symbol);
  console.log("owner", owner);

  const tt = await ethers.getContractAt(
    "RibbonToken",
    stakingToken
  );

  const votingEscrow = await VotingEscrow.deploy(
    stakingToken,
    name,
    symbol,
    owner,
  );

  await votingEscrow.deployed();

  console.log(
    `\nRibbon voting lockup contract is deployed at ${votingEscrow.address}, verify with https://etherscan.io/proxyContractChecker?a=${votingEscrow.address}\n`
  );

  await votingEscrow.deployTransaction.wait(5);

  await hre.run("verify:verify", {
    address: votingEscrow.address,
    constructorArguments: [stakingToken, name, symbol, owner],
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
