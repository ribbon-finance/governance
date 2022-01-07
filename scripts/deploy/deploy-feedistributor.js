const hre = require("hardhat");
const { FEEDISTRIBUTOR_PARAMS, AIRDROP_PARAMS } = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;
const { getTimestamp } = require("test/utils/time");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const FeeDistributor = await hre.ethers.getContractFactory(
    "FeeDistributor",
    deployer
  );

  const voting_escrow =
    network === "kovan"
      ? "0x7Ef22e238E663022bBCE210632468ca9ae83A12C"
      : FEEDISTRIBUTOR_PARAMS.VOTINGESCROW;

  const start_time = await getTimestamp();

  const token =
    network === "kovan"
      ? "0x80ba81056ba048c82b7b01eb8bffe342fde1998d"
      : AIRDROP_PARAMS.TOKEN_ADDRESS;

  const o_admin =
    network === "kovan" ? deployer.address : FEEDISTRIBUTOR_PARAMS.O_ADMIN;

  const e_admin =
    network === "kovan" ? deployer.address : FEEDISTRIBUTOR_PARAMS.E_ADMIN;

  console.log("voting_escrow", voting_escrow);
  console.log("start_time", start_time);
  console.log("token", token);
  console.log("o_admin", o_admin);
  console.log("e_admin", e_admin);

  const feeDistributor = await FeeDistributor.deploy(
    voting_escrow,
    start_time,
    token,
    o_admin,
    e_admin,
  );

  await feeDistributor.deployed();

  console.log(
    `\nRibbon fee distributor contract is deployed at ${feeDistributor.address}, verify with https://etherscan.io/proxyContractChecker?a=${feeDistributor.address}\n`
  );

  await feeDistributor.deployTransaction.wait(5);

  await hre.run("verify:verify", {
    address: feeDistributor.address,
    constructorArguments: [voting_escrow, start_time, token, o_admin, e_admin],
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
