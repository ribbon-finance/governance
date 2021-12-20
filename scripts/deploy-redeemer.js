const hre = require("hardhat");
const { VOTINGLOCKUP_PARAMS, AIRDROP_PARAMS } = require("../params");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const Redeemer = await hre.ethers.getContractFactory("Redeemer", deployer);

  const owner = network === "kovan" ? deployer.address : REDEEMER_PARAMS.OWNER;

  // 90%
  const maxRedeemPCT = 9000;

  console.log("owner", owner);
  console.log("maxRedeemPCT", maxRedeemPCT);

  const redeemer = await Redeemer.deploy(owner, maxRedeemPCT);

  await redeemer.deployed();

  console.log(
    `\nRibbon redeemer contract is deployed at ${redeemer.address}, verify with https://etherscan.io/proxyContractChecker?a=${redeemer.address}\n`
  );

  await redeemer.deployTransaction.wait(5);

  await hre.run("verify:verify", {
    address: redeemer.address,
    constructorArguments: [owner, maxRedeemPCT],
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
