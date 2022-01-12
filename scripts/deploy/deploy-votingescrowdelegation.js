const hre = require("hardhat");
const { MAIN_RIBBONOMICS_DIR, TEST_RIBBONOMICS_DIR } = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const VotingEscrowDelegation = await hre.ethers.getContractFactory(
    "VotingEscrowDelegation",
    deployer
  );

  const name = "Voting Escrow Boost Delegation"

  const symbol = "veBoost"

  const base_uri = ""

  const voting_escrow =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.VOTINGESCROW
      : MAIN_RIBBONOMICS_DIR.VOTINGESCROW;

  const admin =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.O_ADMIN;

  console.log("name", name);
  console.log("symbol", symbol);
  console.log("base_uri", base_uri);
  console.log("voting_escrow", voting_escrow);
  console.log("admin", admin);

  const votingEscrowDelegation = await VotingEscrowDelegation.deploy(
    name,
    symbol,
    base_uri,
    voting_escrow,
    admin
  );

  await votingEscrowDelegation.deployed();

  console.log(
    `\nRibbon voting escrow delegation contract is deployed at ${votingEscrowDelegation.address}, verify with https://etherscan.io/proxyContractChecker?a=${votingEscrowDelegation.address}\n`
  );

  await votingEscrowDelegation.deployTransaction.wait(5);

  const veboost_proxy =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.VEBOOSTPROXY
      : MAIN_RIBBONOMICS_DIR.VEBOOSTPROXY;

  const veboostproxy = await ethers.getContractAt(
    "DelegationProxy",
    veboost_proxy
  );

  // add as delegation
  await veboostproxy["set_delegation(address)"](votingEscrowDelegation.address)

  await hre.run("verify:verify", {
    address: votingEscrowDelegation.address,
    constructorArguments: [name, symbol, base_uri, voting_escrow, admin],
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
