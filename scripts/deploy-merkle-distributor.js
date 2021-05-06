const hre = require("hardhat");
const { AIRDROP_PARAMS } = require("../params");

async function main() {
  // We get the contract to deploy
  const MerkleDistributor = await hre.ethers.getContractFactory(
    "MerkleDistributor"
  );
  const merkleDistributor = await MerkleDistributor.deploy(
    AIRDROP_PARAMS.OWNER,
    AIRDROP_PARAMS.TOKEN_ADDRESS,
    AIRDROP_PARAMS.MERKLE_ROOT,
    AIRDROP_PARAMS.DAYS_UNTIL_UNLOCK
  );

  await merkleDistributor.deployed();

  console.log(
    `\nMerkle distributor is deployed at ${merkleDistributor.address}, verify with https://etherscan.io/proxyContractChecker?a=${merkleDistributor.address}\n`
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
