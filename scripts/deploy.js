const hre = require("hardhat");
const { TOKEN_PARAMS } = require("../params");

async function main() {
  // We get the contract to deploy
  const RibbonToken = await hre.ethers.getContractFactory("RibbonToken");
  const ribbonToken = await RibbonToken.deploy(
    TOKEN_PARAMS.NAME,
    TOKEN_PARAMS.SYMBOL,
    TOKEN_PARAMS.SUPPLY,
    TOKEN_PARAMS.OWNER
  );

  await ribbonToken.deployed();

  console.log(
    `\nRibbon token is deployed at ${ribbonToken.address}, verify with https://etherscan.io/proxyContractChecker?a=${ribbonToken.address}\n`
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
