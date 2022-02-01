import { Contract, ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import hre from "hardhat";
import { network } from "hardhat";
import { ensureOnlyExpectedMutativeFunctions } from "../helpers";
import { assert, addSnapshotBeforeRestoreAfterEach } from "../common";
import {
  currentTime,
  toUnit,
  fastForward,
  assertBNGreaterThan,
  assertBNLessThan,
} from "../utils";
import { expect } from "chai";

const { ethers } = hre;
const { provider, BigNumber } = ethers;

const { formatEther } = require("@ethersproject/units");

// Asset symbol => [gauge, underlying/eth oracle]
// ex: rBTC-THETA => [rBTC-THETA-gauge address, BTC/ETH oracle]
const vaults: any = {
  "rETH-THETA": ["0x78b6dd0cD4697f9a62851323BeA8a3b3Bf213241", "0x0000000000000000000000000000000000000001"],
  "rstETH-THETA": ["0xAF23AdB205169A5DF1dB7321BF1A8D7DeA2F8ABd", "0x0000000000000000000000000000000000000001"],
  "rBTC-THETA": ["0xe53851c18e01ca5f8537246f37fb7de048619892", "0xdeb288F737066589598e9214E782fa5A8eD689e8"],
  "rAAVE-THETA": ["0x12Dc10F72a64ce07d2b3D41420f2276f8c560919", "0x6Df09E975c830ECae5bd4eD9d90f3A95a4f88012"],
}

// Tests taken from https://github.com/Synthetixio/synthetix/blob/master/test/contracts/StakingRewards.js
describe("VaultPriceOracle", function () {
  let VaultPriceOracle: ContractFactory;
  let CToken: ContractFactory;
  let owner: SignerWithAddress;
  let account3: SignerWithAddress;

  let vaultPriceOracle: Contract,
      oracles: Array<Contract>,
      liquidityGauges: Array<Contract>,
      ribbonVaults: Array<Contract>,
      cTokens: Array<Contract>,
      oracleOwner: Contract;

  addSnapshotBeforeRestoreAfterEach();

  before(async () => {
    [
      owner,
      account3,
    ] = await ethers.getSigners();

    // Reset block
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TEST_URI,
            blockNumber: 14119000,
          },
        },
      ],
    });

    VaultPriceOracle = await ethers.getContractFactory("VaultPriceOracle");
    CToken = await ethers.getContractFactory("CToken");
    oracles = [];
    liquidityGauges = [];
    ribbonVaults = [];
    cTokens = [];

    vaultPriceOracle = await VaultPriceOracle.deploy(
      owner.address,
      true
    );

    await vaultPriceOracle.deployed();

    let vault: keyof typeof vaults;

    for (let vault in vaults) {
      // Get gauge
      let gauge = await ethers.getContractAt(
        "ILiquidityGauge",
        vaults[vault][0]
      );

      // Get oracle
      let oracle = await ethers.getContractAt(
        "IAggregatorV3Interface",
        vaults[vault][1]
      );

      // Get ribbon vault
      let ribbonVault = await ethers.getContractAt(
        "IRibbonVault",
        await gauge.lp_token()
      );

      let cToken = await CToken.deploy();
      await cToken.deployed();

      await cToken.setUnderlying(gauge.address)

      liquidityGauges.push(gauge)
      oracles.push(oracle)
      ribbonVaults.push(ribbonVault)
      cTokens.push(cToken)
    }
  });

  it("ensure only known functions are mutative", async () => {
    ensureOnlyExpectedMutativeFunctions({
      abi: (await hre.artifacts.readArtifact("VaultPriceOracle")).abi,
      ignoreParents: [],
      expected: [
        "changeAdmin",
        "setPriceFeeds",
      ],
    });
  });

  describe("Constructor & Settings", () => {
    it("should set admin on constructor", async () => {
      assert.equal(await vaultPriceOracle.admin(), owner.address);
    });

    it("should set admin overrite on constructor", async () => {
      assert.equal(await vaultPriceOracle.canAdminOverwrite(), true);
    });
  });

  describe("Function permissions", () => {
    it("changes admin", async () => {
      await vaultPriceOracle.changeAdmin(account3.address);
      assert.equal(await vaultPriceOracle.admin(), account3.address);
    });

    it("only admin address can call changeAdmin", async () => {
      assert.revert(
        vaultPriceOracle.connect(account3).changeAdmin(account3.address),
        "Sender is not the admin."
      );
    });

    it("only admin address can call setPriceFeeds", async () => {
      assert.revert(
        vaultPriceOracle.setPriceFeeds(["0x78b6dd0cD4697f9a62851323BeA8a3b3Bf213241"], ["0x6df09e975c830ecae5bd4ed9d90f3a95a4f88012"], 0),
        "Sender is not the admin."
      );
    });

    it("cannot overwrite oracle when overwrite false", async () => {
      let vaultPriceOracle = await VaultPriceOracle.deploy(
            owner.address,
            false
          );

      vaultPriceOracle.setPriceFeeds(["0x78b6dd0cD4697f9a62851323BeA8a3b3Bf213241"], ["0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"], 0);

      assert.revert(
        vaultPriceOracle.setPriceFeeds(["0x78b6dd0cD4697f9a62851323BeA8a3b3Bf213241"], ["0x6df09e975c830ecae5bd4ed9d90f3a95a4f88012"], 0),
        "Admin cannot overwrite existing assignments of price feeds to underlying tokens."
      );
    });
  });

  describe("Set Price Feeds", () => {
    beforeEach(async () => {
      for (let vault in vaults) {
        // gauge, oracle for underlying asset of vault token of gauge, 0 for eth denominated price feed
        await vaultPriceOracle.setPriceFeeds([vaults[vault][0]], [vaults[vault][1]], 0);
      }
    });

    it("should set price feeds", async () => {
      for (let vault in vaults) {
        assert.equal(await vaultPriceOracle.priceFeeds(vaults[vault][0]), vaults[vault][1])
        assert.bnEqual(await vaultPriceOracle.feedBaseCurrencies(vaults[vault][0]), 0)
      }
    });

    it("should get correct price()", async () => {
      let v = Object.keys(vaults);

      for (let i = 0; i < oracles.length; i++) {
        let tokenEthPrice = BigNumber.from(1);
        let rVaultDecimals = await ribbonVaults[i].decimals();
        let rVaultToAssetExchangeRate = await ribbonVaults[i].pricePerShare(); // (ex: rETH-THETA -> ETH, rBTC-THETA -> BTC)
        let actualPrice = rVaultToAssetExchangeRate;
        if(oracles[i].address != "0x0000000000000000000000000000000000000001"){
          let [, price, , , ] = await oracles[i].latestRoundData()
          tokenEthPrice = price;
          actualPrice = parseInt(tokenEthPrice.toString()) > 0 ? tokenEthPrice.mul(rVaultToAssetExchangeRate).div(rVaultDecimals): 0;
        }

        let chainlinkPrice = await vaultPriceOracle.price(liquidityGauges[i].address);
        console.log(`${v[i]} underlying price per token is ${chainlinkPrice}`);
        assert.bnEqual(actualPrice, chainlinkPrice)
      }
    });

    it("should get correct getUnderlyingPrice()", async () => {
      let v = Object.keys(vaults);

      for (let i = 0; i < oracles.length; i++) {
        let tokenEthPrice = BigNumber.from(1);
        let rVaultDecimals = await ribbonVaults[i].decimals();
        let rVaultToAssetExchangeRate = await ribbonVaults[i].pricePerShare(); // (ex: rETH-THETA -> ETH, rBTC-THETA -> BTC)
        let actualPrice = rVaultToAssetExchangeRate;
        if(oracles[i].address != "0x0000000000000000000000000000000000000001"){
          let [, price, , , ] = await oracles[i].latestRoundData()
          tokenEthPrice = price;
          actualPrice = parseInt(tokenEthPrice.toString()) > 0 ? tokenEthPrice.mul(rVaultToAssetExchangeRate).div(rVaultDecimals): 0;
        }

        let chainlinkPrice = await vaultPriceOracle.getUnderlyingPrice(cTokens[i].address);
        console.log(`${v[i]} underlying price per token is ${chainlinkPrice}`);
        assert.bnEqual(actualPrice, chainlinkPrice)
      }
    });
  });
});
