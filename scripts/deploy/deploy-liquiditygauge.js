const hre = require("hardhat");
const { MAIN_RIBBONOMICS_DIR, TEST_RIBBONOMICS_DIR } = require("../../params");
const { ethers } = hre;
const { BigNumber } = ethers;

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // We get the contract to deploy
  const LiquidityGauge = await hre.ethers.getContractFactory(
    "LiquidityGaugeV4",
    deployer
  );

  const vaults =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.VAULTS
      : MAIN_RIBBONOMICS_DIR.VAULTS;

  const minter =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.MINTER
      : MAIN_RIBBONOMICS_DIR.MINTER;

  const admin =
    network === "kovan" ? deployer.address : MAIN_RIBBONOMICS_DIR.O_ADMIN;

  console.log("minter", name);
  console.log("admin", symbol);

  for (let vault in vaults) {
      const liquidityGauge = await LiquidityGauge.deploy(
        vaults[vault],
        minter,
        admin
      );

      await liquidityGauge.deployed();

      console.log(
        `\nRibbon liquidity gauge contract for vault ${vault} is deployed at ${liquidityGauge.address}, verify with https://etherscan.io/proxyContractChecker?a=${liquidityGauge.address}\n`
      );

      await liquidityGauge.deployTransaction.wait(5);

      await hre.run("verify:verify", {
        address: liquidityGauge.address,
        constructorArguments: [vaults[vault], minter, admin],
      });
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
