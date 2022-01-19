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

  const gauge_type_idx =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.GAUGETYPEIDX
      : MAIN_RIBBONOMICS_DIR.GAUGETYPEIDX;

  const gauge_controller =
    network === "kovan"
      ? TEST_RIBBONOMICS_DIR.GAUGECONTROLLER
      : MAIN_RIBBONOMICS_DIR.GAUGECONTROLLER;

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

  console.log("minter", minter);
  console.log("admin", admin);

  const gaugeController = await ethers.getContractAt(
    "GaugeController",
    gauge_controller
  );

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

      // add_gauge()
      await gaugeController["add_gauge(address,int128)"](liquidityGauge.address, gauge_type_idx)

      console.log(
        `\nAdded gauge for vault ${vault} to controller\n`
      );

      // await hre.run("verify:verify", {
      //   address: liquidityGauge.address,
      //   constructorArguments: [vaults[vault], minter, admin],
      // });
  }

  await gaugeController["commit_transfer_ownership(address)"](MAIN_RIBBONOMICS_DIR.O_ADMIN)
  await gaugeController["apply_transfer_ownership()"]()
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
