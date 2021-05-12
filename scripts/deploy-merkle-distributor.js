const hre = require("hardhat");
const { AIRDROP_PARAMS } = require("../params");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const MerkleDistributor = await hre.ethers.getContractFactory(
    "MerkleDistributor",
    deployer
  );

  const owner =
    network === "kovan"
      ? "0xc62DC8D0Fa2dB60ECA118984067c6ad011Bf598A"
      : AIRDROP_PARAMS.OWNER;
  const tokenAddress =
    network === "kovan"
      ? "0x567e482AF973187648Af9FC56d2Caec212c1CAca"
      : AIRDROP_PARAMS.TOKEN_ADDRESS;
  //merkle root for example2.json
  const merkleRoot =
    network === "kovan"
      ? "0x2018c6b9b1a3fd7822b79c24c3dd87ad8545030c0a305a0389d8fd10a361b2f8"
      : AIRDROP_PARAMS.MERKLE_ROOT;

  const merkleDistributor = await MerkleDistributor.deploy(
    owner,
    tokenAddress,
    merkleRoot,
    AIRDROP_PARAMS.DAYS_UNTIL_UNLOCK
  );

  await merkleDistributor.deployed();

  console.log(
    `\nMerkle distributor is deployed at ${merkleDistributor.address}, verify with https://etherscan.io/address/${merkleDistributor.address}\n`
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
