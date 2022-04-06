const hre = require("hardhat");
const { MAIN_RIBBONOMICS_DIR, TEST_RIBBONOMICS_DIR, DAO_MULTISIG } = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;
const { getTimestamp } = require("../../test/utils/time");

async function main() {
  const [, deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const FeeCustody = await hre.ethers.getContractFactory(
    "FeeCustody",
    deployer
  );

  const pct_allocation_for_rbn_lockers =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.RBN_PROTOCOL_REVENUE_ALLOCATION
      : MAIN_RIBBONOMICS_DIR.RBN_PROTOCOL_REVENUE_ALLOCATION;

  const fee_distributor =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.FEEDISTRIBUTOR
      : MAIN_RIBBONOMICS_DIR.FEEDISTRIBUTOR;

  const protocol_revenue_dao_recipient = network === "kovan"
      ? deployer.address
      : DAO_MULTISIG;

  const admin =
    network === "kovan"
      ? deployer.address
      : MAIN_RIBBONOMICS_DIR.O_ADMIN;

  const keeper =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.KEEPER;

  console.log("pct_allocation_for_rbn_lockers", pct_allocation_for_rbn_lockers);
  console.log("fee_distributor", fee_distributor);
  console.log("protocol_revenue_dao_recipient", protocol_revenue_dao_recipient);
  console.log("admin", admin);
  console.log("keeper", keeper);

  const feeCustody = await FeeCustody.deploy(
    pct_allocation_for_rbn_lockers,
    fee_distributor,
    protocol_revenue_dao_recipient,
    admin,
    keeper
  );

  await feeCustody.deployed();

  console.log(
    `\nRibbon fee custody contract is deployed at ${feeCustody.address}, verify with https://etherscan.io/proxyContractChecker?a=${feeCustody.address}\n`
  );

  await feeCustody.deployTransaction.wait(5);

  await hre.run("verify:verify", {
    address: feeCustody.address,
    constructorArguments: [
      pct_allocation_for_rbn_lockers,
      fee_distributor,
      protocol_revenue_dao_recipient,
      admin,
      keeper,
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