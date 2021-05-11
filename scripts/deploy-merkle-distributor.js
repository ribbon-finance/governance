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
      ? "0xDe553DA1D4a7733f86a6C87E785cA5b752A3D03d"
      : AIRDROP_PARAMS.TOKEN_ADDRESS;
  //merkle root for example2.json
  const merkleRoot =
    network === "kovan"
      ? "0x854b13abff6a9ebc1d59cd6f97cca326757e1c4c22a8b8cfe0c10ca42c1142ea"
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
