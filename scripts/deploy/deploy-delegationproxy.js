const hre = require("hardhat");
const { MAIN_RIBBONOMICS_DIR, TEST_RIBBONOMICS_DIR } = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const DelegationProxy = await hre.ethers.getContractFactory(
    "DelegationProxy",
    deployer
  );

  const delegation =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.DELEGATION
      : MAIN_RIBBONOMICS_DIR.DELEGATION;

  const voting_escrow =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.VOTINGESCROW
      : MAIN_RIBBONOMICS_DIR.VOTINGESCROW;

  const o_admin =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.O_ADMIN;

  const e_admin =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.E_ADMIN;

  console.log("delegation", delegation);
  console.log("voting_escrow", voting_escrow);
  console.log("o_admin", o_admin);
  console.log("e_admin", e_admin);

  const delegationProxy = await DelegationProxy.deploy(
    delegation,
    voting_escrow,
    o_admin,
    e_admin,
  );

  await delegationProxy.deployed();

  console.log(
    `\nRibbon delegation proxy contract is deployed at ${delegationProxy.address}, verify with https://etherscan.io/proxyContractChecker?a=${delegationProxy.address}\n`
  );

  await delegationProxy.deployTransaction.wait(5);

  await hre.run("verify:verify", {
    address: delegationProxy.address,
    constructorArguments: [delegation, voting_escrow, o_admin, e_admin],
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
