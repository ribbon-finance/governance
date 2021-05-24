const hre = require("hardhat");
const { TOKEN_PARAMS } = require("../params");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const RibbonToken = await hre.ethers.getContractFactory(
    "RibbonToken",
    deployer
  );

  // Use a different name for obfuscation just in case anyone's watching
  const name = network === "kovan" ? "TestToken" : TOKEN_PARAMS.NAME;
  const symbol = network === "kovan" ? "TT" : TOKEN_PARAMS.SYMBOL;
  const beneficiary =
    network === "kovan" ? deployer.address : TOKEN_PARAMS.BENIFICIARY;

  console.log("name", name);
  console.log("symbol", symbol);
  console.log("beneficiary", beneficiary);
  console.log("supply", TOKEN_PARAMS.SUPPLY.toString());

  const ribbonToken = await RibbonToken.deploy(
    name,
    symbol,
    TOKEN_PARAMS.SUPPLY,
    beneficiary
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
