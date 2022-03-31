/* eslint-disable @typescript-eslint/dot-notation */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/naming-convention */

import { Contract, ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import { getTimestamp, takeSnapshot, revertToSnapShot } from "../utils/time";
import { addSnapshotBeforeRestoreAfterEach } from "./common";
import { BN, simpleToExactAmount } from "../utils/math";
import { StandardAccounts } from "../utils/machines";
import { Account } from "../../types";
import { ZERO_ADDRESS } from "../utils/constants";
import { MAIN_RIBBONOMICS_DIR } from "../../params";
const { getContractAt, provider } = ethers;

import {
  ONE_WEEK,
  DEFAULT_DECIMALS,
  TEST_URI,
  WETH_ADDRESS,
  WBTC_ADDRESS,
  USDC_ADDRESS,
  AAVE_ADDRESS,
  WETH_OWNER_ADDRESS,
  WBTC_OWNER_ADDRESS,
  USDC_OWNER_ADDRESS,
  AAVE_OWNER_ADDRESS,
  ETH_PRICE_ORACLE,
  BTC_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  AAVE_PRICE_ORACLE,
  BAD_PRICE_ORACLE,
  DEX_ROUTER,
  DEX_FACTORY,
  ETH_USDC_POOL,
  ETH_BTC_POOL,
  ETH_BTC_POOL_S,
  BTC_USDC_POOL,
  ETH_AAVE_POOL,
  POOL_LARGE_FEE,
  POOL_SMALL_FEE,
  PCT_AllOC_FOR_LOCKERS
 } from "../utils/constants";
chai.use(solidity);

const ASSET_DEPOSITS_OWNERS = {
  WETH_ADDRESS: [WETH_OWNER_ADDRESS, BigNumber.from(1).mul(BigNumber.from(10).pow(18))],
  WBTC_ADDRESS: [WBTC_OWNER_ADDRESS, BigNumber.from(1).mul(BigNumber.from(10).pow(8))],
  USDC_ADDRESS: [USDC_OWNER_ADDRESS, BigNumber.from(1000).mul(BigNumber.from(10).pow(6))],
  AAVE_ADDRESS: [AAVE_OWNER_ADDRESS, BigNumber.from(10).mul(BigNumber.from(10).pow(18))],
};

const ASSET_TO_CHAINLINK = {
  WETH_ADDRESS: ETH_PRICE_ORACLE,
  WBTC_ADDRESS: BTC_PRICE_ORACLE,
  USDC_ADDRESS: USDC_PRICE_ORACLE,
  AAVE_ADDRESS: AAVE_PRICE_ORACLE,
};

describe("Fee Custody", () => {
  let FeeCustody: ContractFactory;

  let feeCustody: Contract,
      feeDistributor: Contract;

  addSnapshotBeforeRestoreAfterEach();

  before("Init contract", async () => {
    // Reset block
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: TEST_URI,
            blockNumber: 14485500,
          },
        },
      ],
    });

    const accounts = await ethers.getSigners();
    sa = await new StandardAccounts().initAccounts(accounts);

    feeDistributor = await ethers.getContractAt("IFeeDistributor", MAIN_RIBBONOMICS_DIR["FEEDISTRIBUTOR"])

    FeeCustody = await ethers.getContractFactory(
      "FeeCustody"
    );
    feeCustody = await FeeCustody.deploy(
      PCT_AllOC_FOR_LOCKERS,
      feeDistributor.address,
      sa.fundManager.address,
      sa.fundManager.address,
      sa.fundManager2.address
    );

    await feeCustody.deployed();
  });

  describe("checking public variables", () => {
    // Constructor
      // sets pctAllocationForRBNLockers
      // sets distributionToken
      // sets feeDistributor
      // sets protocolRevenueRecipient
      // sets keeper
      // transfers ownership

    it("returns pctAllocationForRBNLockers", async () => {
      expect(await feeCustody.pctAllocationForRBNLockers()).eq(PCT_AllOC_FOR_LOCKERS);
    });

    it("returns distributionToken", async () => {
      expect(await feeCustody.distributionToken()).eq(WETH_ADDRESS);
    });

    it("returns feeDistributor", async () => {
      expect(await feeCustody.feeDistributor()).eq(feeDistributor.address);
    });

    it("returns protocolRevenueRecipient", async () => {
      expect(await feeCustody.protocolRevenueRecipient()).eq(sa.fundManager.address);
    });

    it("returns emergency return address", async () => {
      expect(await feeDistributor.owner()).eq(
        sa.fundManager.address
      );
    });

    it("returns keeper", async () => {
      expect(await feeDistributor.keeper()).eq(
        sa.fundManager2.address
      );
    });
  });

  describe("Admin Permissions", () => {
    // onlyOwner:
      // distributeProtocolRevenue
      // setAsset
      // recoverAllAssets
      // recoverAsset
      // setFeeDistributor
      // setDistributionToken
      // setProtocolRevenueRecipient
      // set keeper

    it("it reverts when non-keeper calls distributeProtocolRevenue", async () => {
      await expect(
        feeCustody
          .connect(sa.fundManager.signer)
          .distributeProtocolRevenue([], 0)
      ).to.be.revertedWith("!keeper");
    });

    it("it reverts when non-owner calls setAsset", async () => {
      await expect(
        feeCustody
          .connect(sa.other.signer)
          .setAsset(ZERO_ADDRESS, ZERO_ADDRESS, [], [])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("it reverts when non-owner calls recoverAllAssets", async () => {
      await expect(
        feeCustody
          .connect(sa.other.signer)
          .recoverAllAssets()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("it reverts when non-owner calls recoverAsset", async () => {
      await expect(
        feeCustody
          .connect(sa.other.signer)
          .recoverAsset(ZERO_ADDRESS)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("it reverts when non-owner calls setFeeDistributor", async () => {
      await expect(
        feeCustody
          .connect(sa.other.signer)
          .setFeeDistributor(ZERO_ADDRESS)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("it reverts when non-owner calls setDistributionToken", async () => {
      await expect(
        feeCustody
          .connect(sa.other.signer)
          .setDistributionToken(ZERO_ADDRESS)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("it reverts when non-owner calls setRBNLockerAllocPCT", async () => {
      await expect(
        feeCustody
          .connect(sa.other.signer)
          .setRBNLockerAllocPCT(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("it reverts when non-owner calls setProtocolRevenueRecipient", async () => {
      await expect(
        feeCustody
          .connect(sa.other.signer)
          .setProtocolRevenueRecipient(ZERO_ADDRESS)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("it reverts when non-owner calls setKeeper", async () => {
      await expect(
        feeCustody
          .connect(sa.other.signer)
          .setKeeper(ZERO_ADDRESS)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Setters", () => {
      // setAsset
      // setFeeDistributor
      // setDistributionToken
      // setProtocolRevenueRecipient
      // setRBNLockerAllocPCT
      // setKeeper

    it("it reverts when setting ZERO_ADDRESS as feeDistributor", async () => {
      await expect(
        feeCustody
          .connect(sa.fundManager.signer)
          .setFeeDistributor(ZERO_ADDRESS)
      ).to.be.revertedWith("!_feeDistributor");
    });

    it("it reverts when setting ZERO_ADDRESS as distributionToken", async () => {
      await expect(
        feeCustody
          .connect(sa.fundManager.signer)
          .setDistributionToken(ZERO_ADDRESS)
      ).to.be.revertedWith("!_distributionToken");
    });

    it("it reverts when setting ZERO_ADDRESS as protocolRevenueRecipient", async () => {
      await expect(
        feeCustody
          .connect(sa.fundManager.signer)
          .setProtocolRevenueRecipient(ZERO_ADDRESS)
      ).to.be.revertedWith("!_protocolRevenueRecipient");
    });

    it("it reverts when setting pct > 10000 as setRBNLockerAllocPCT", async () => {
      await expect(
        feeCustody
          .connect(sa.fundManager.signer)
          .setRBNLockerAllocPCT(10001)
      ).to.be.revertedWith("!_pctAllocationForRBNLockers");
    });

    it("it reverts when setting ZERO_ADDRESS as setKeeper", async () => {
      await expect(
        feeCustody
          .connect(sa.fundManager.signer)
          .setKeeper(ZERO_ADDRESS)
      ).to.be.revertedWith("!_keeper");
    });

    it("it reverts when passing ZERO_ADDRESS as asset to setAsset", async () => {
      await expect(
        feeCustody
          .connect(sa.fundManager.signer)
          .setAsset(ZERO_ADDRESS, ZERO_ADDRESS, [], [])
      ).to.be.revertedWith("!_asset");
    });

    it("it reverts when passing non-USD denominated oracle to setAsset", async () => {
      await expect(
        feeCustody
          .connect(sa.fundManager.signer)
          .setAsset(WETH_ADDRESS, BAD_PRICE_ORACLE, [], [])
      ).to.be.revertedWith("!ASSET/USD");
    });

    it("it reverts when passing intermediaryPath length > 1 to setAsset", async () => {
      await expect(
        feeCustody
          .connect(sa.fundManager.signer)
          .setAsset(WETH_ADDRESS, ETH_PRICE_ORACLE, [WETH_ADDRESS, WETH_ADDRESS], [])
      ).to.be.revertedWith("invalid intermediary path");
    });

    it("it reverts when passing swap fee array length != intermediaryPath len + 1 to setAsset", async () => {
      await expect(
        feeCustody
          .connect(sa.fundManager.signer)
          .setAsset(WETH_ADDRESS, ETH_PRICE_ORACLE, [], [])
      ).to.be.revertedWith("invalid pool fees array length");
      await expect(
        feeCustody
          .connect(sa.fundManager.signer)
          .setAsset(WETH_ADDRESS, ETH_PRICE_ORACLE, [WETH_ADDRESS], [])
      ).to.be.revertedWith("invalid pool fees array length");
      await expect(
        feeCustody
          .connect(sa.fundManager.signer)
          .setAsset(WETH_ADDRESS, ETH_PRICE_ORACLE, [WETH_ADDRESS], [POOL_LARGE_FEE])
      ).to.be.revertedWith("invalid pool fees array length");
    });

    it("it sets feeDistributor", async () => {
      await feeCustody
        .connect(sa.fundManager.signer)
        .setFeeDistributor(DEX_ROUTER)

      expect(await feeCustody.feeDistributor()).eq(DEX_ROUTER)
    });

    it("it sets distributionToken", async () => {
      await feeCustody
        .connect(sa.fundManager.signer)
        .setDistributionToken(WBTC_ADDRESS)

      expect(await feeCustody.distributionToken()).eq(WBTC_ADDRESS)
    });

    it("it sets protocolRevenueRecipient", async () => {
      await feeCustody
        .connect(sa.fundManager.signer)
        .setProtocolRevenueRecipient(sa.other.address)
      expect(await feeCustody.protocolRevenueRecipient()).eq(sa.other.address)
    });

    it("it sets pctAllocationForRBNLockers", async () => {
      await feeCustody
        .connect(sa.fundManager.signer)
        .setRBNLockerAllocPCT(10000)
      expect(await feeCustody.pctAllocationForRBNLockers()).eq(10000)
    });

    it("it sets keeper", async () => {
      await feeCustody
        .connect(sa.fundManager2.signer)
        .setKeeper(sa.other.address)
      expect(await feeCustody.keeper()).eq(sa.other.address)
    });

    it("it sets setAsset", async () => {
      let lastAssetIdx = await feeCustody.lastAssetIdx();

      let txn = await feeCustody
        .connect(sa.fundManager.signer)
        .setAsset(USDC_ADDRESS, USDC_PRICE_ORACLE, [], [POOL_LARGE_FEE])

      expect(await feeCustody.assets(lastAssetIdx)).eq(USDC_ADDRESS)
      expect(await feeCustody.lastAssetIdx()).eq(1)
      expect(await feeCustody.oracles(USDC_ADDRESS)).eq(USDC_PRICE_ORACLE)

      let pathEncodePacked = ethers.utils.solidityPack(["address", "uint256", "address"], [USDC_ADDRESS, POOL_LARGE_FEE, WETH_ADDRESS])

      expect(await feeCustody.intermediaryPath(USDC_ADDRESS)).eq(pathEncodePacked)

      await expect(txn).to.emit(feeCustody, "NewAsset").withArgs(USDC_ADDRESS, pathEncodePacked);
    });

    it("it sets setAsset with intermediaryPath", async () => {
      let lastAssetIdx = await feeCustody.lastAssetIdx();

      let txn = await feeCustody
        .connect(sa.fundManager.signer)
        .setAsset(USDC_ADDRESS, USDC_PRICE_ORACLE, [WBTC_ADDRESS], [POOL_LARGE_FEE, POOL_LARGE_FEE])

      expect(await feeCustody.assets(lastAssetIdx)).eq(USDC_ADDRESS)
      expect(await feeCustody.lastAssetIdx()).eq(1)
      expect(await feeCustody.oracles(USDC_ADDRESS)).eq(USDC_PRICE_ORACLE)

      let pathEncodePacked = ethers.utils.solidityPack(["address", "uint256", "address"], [USDC_ADDRESS, POOL_LARGE_FEE, WBTC_ADDRESS, POOL_LARGE_FEE, WETH_ADDRESS])

      expect(await feeCustody.intermediaryPath(USDC_ADDRESS)).eq(pathEncodePacked)

      await expect(txn).to.emit(feeCustody, "NewAsset").withArgs(USDC_ADDRESS, pathEncodePacked);
    });

    it("it updates already setAsset", async () => {
      let lastAssetIdx = await feeCustody.lastAssetIdx();

      await feeCustody
        .connect(sa.fundManager.signer)
        .setAsset(USDC_ADDRESS, BTC_PRICE_ORACLE, [], [POOL_SMALL_FEE])

      let txn = await feeCustody
        .connect(sa.fundManager.signer)
        .setAsset(USDC_ADDRESS, USDC_PRICE_ORACLE, [], [POOL_LARGE_FEE])

      expect(await feeCustody.assets(lastAssetIdx)).eq(USDC_ADDRESS)
      expect(await feeCustody.lastAssetIdx()).eq(1)
      expect(await feeCustody.oracles(USDC_ADDRESS)).eq(USDC_PRICE_ORACLE)

      let pathEncodePacked = ethers.utils.solidityPack(["address", "uint256", "address"], [USDC_ADDRESS, POOL_LARGE_FEE, WETH_ADDRESS])

      expect(await feeCustody.intermediaryPath(USDC_ADDRESS)).eq(pathEncodePacked)

      await expect(txn).to.emit(feeCustody, "NewAsset").withArgs(USDC_ADDRESS, pathEncodePacked);
    });
  });

  describe("Protocol Revenue Distribution", () => {
    let ASSET_BALANCES_BEFORE = {};
    beforeEach(async () => {
      await feeCustody
        .connect(sa.fundManager.signer)
        .setAsset(WETH_ADDRESS, ETH_PRICE_ORACLE, [], [POOL_LARGE_FEE])

      await feeCustody
        .connect(sa.fundManager.signer)
        .setAsset(USDC_ADDRESS, USDC_PRICE_ORACLE, [], [POOL_LARGE_FEE])

      await feeCustody
        .connect(sa.fundManager.signer)
        .setAsset(WBTC_ADDRESS, BTC_PRICE_ORACLE, [], [POOL_LARGE_FEE])

      await feeCustody
        .connect(sa.fundManager.signer)
        .setAsset(AAVE_ADDRESS, AAVE_PRICE_ORACLE, [], [POOL_LARGE_FEE])

      for (let asset in ASSET_DEPOSITS_OWNERS) {
          let [asset_owner, amount] = ASSET_DEPOSITS_OWNERS[asset];
          await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [asset_owner],
          });
          const owner = await ethers.provider.getSigner(
            asset_owner
          );

          const token = await ethers.getContractAt("IERC20", asset);
          await token.connect(owner).transfer(feeCustody.address, amount);

          let feeCustodyBalanceBefore = await token.balanceOf(feeCustody.address)
          let adminBalanceBefore = await token.balanceOf(await feeCustody.protocolRevenueRecipient())
          ASSET_BALANCES_BEFORE[asset] = [feeCustodyBalanceBefore, adminBalanceBefore]

          expect(feeCustodyBalanceBefore).eq(amount)
      }
    });

    // claimableByRBNLockersOfAsset
    it("it gets correct amount of asset claimable by RBN lockers", async () => {
      let totalWETHDeposited = ASSET_DEPOSITS_OWNERS[WETH_ADDRESS][1];
      expect(await feeCustody.claimableByRBNLockersOfAsset(WETH_ADDRESS)).eq(totalWETHDeposited.mul(await feeCustody.pctAllocationForRBNLockers()).div(await feeCustody.TOTAL_PCT()));
    });

    // claimableByProtocolOfAsset
    it("it gets correct amount of asset claimable by protocol revenue recipient", async () => {
      let totalWETHDeposited = ASSET_DEPOSITS_OWNERS[WETH_ADDRESS][1];
      let totalPCT = await feeCustody.TOTAL_PCT();
      expect(await feeCustody.claimableByProtocolOfAsset(WETH_ADDRESS)).eq(totalWETHDeposited.mul(totalPCT.sub(await feeCustody.pctAllocationForRBNLockers())).div(totalPCT));
    });

    // totalClaimableByRBNLockersInUSD
    it("it gets correct amount of asset claimable by RBN lockers", async () => {
      let totalInUSD;
      let alloctPCT = await feeCustody.pctAllocationForRBNLockers();
      let totalPCT = await feeCustody.TOTAL_PCT();

      for (let asset in ASSET_TO_CHAINLINK) {
          let oracle = ASSET_TO_CHAINLINK[asset];
          const oracle = await ethers.getContractAt("IChainlink", oracle);
          const token = await ethers.getContractAt("IERC20", asset);

          totalInUSD += (await token.balanceOf(feeCustody.address)).mul(await oracle.lastestAnswer()).mul(alloctPCT).div(BigNumber.from(10).mul(BigNumber.from(10).pow(8))).div(totalPCT)
      }

      expect(await feeCustody.totalClaimableByRBNLockersInUSD()).eq(totalInUSD);
    });

    // totalClaimableByProtocolInUSD
    it("it gets correct amount of asset claimable by protocol revenue recipient", async () => {
      let totalInUSD;
      let totalPCT = await feeCustody.TOTAL_PCT();
      let alloctPCT = totalPCT.sub(await feeCustody.pctAllocationForRBNLockers());

      for (let asset in ASSET_TO_CHAINLINK) {
          let oracle = ASSET_TO_CHAINLINK[asset];
          const oracle = await ethers.getContractAt("IChainlink", oracle);
          const token = await ethers.getContractAt("IERC20", asset);

          totalInUSD += (await token.balanceOf(feeCustody.address)).mul(await oracle.lastestAnswer()).mul(alloctPCT).div(BigNumber.from(10).mul(BigNumber.from(10).pow(8))).div(totalPCT)
      }

      expect(await feeCustody.totalClaimableByProtocolInUSD()).eq(totalInUSD);
    });

    // distributeProtocolRevenue
    it("it swaps and distributes protocol revenue to protocol revenue recipient & fee distributor", async () => {
        // For every asset, get min amount out (will set to 0 for simplicity, but will use sdk for weekly distribution cron job)
        // We have 4 assets - eth, btc, usdc, aave
        let minAmountOuts = [0, 0, 0, 0]
        let deadline = (await getTimestamp()) + 100

        let feeDistributorETHBalanceBefore = await provider.getBalance(feeDistributor.address)
        let totalClaimableByRBNLockersInUSD = await feeCustody.totalClaimableByRBNLockersInUSD();

        await feeCustody.connect(sa.fundManager2.signer).distributeProtocolRevenue(minAmountOuts, deadline);

        // by end of swap:
          // make sure all non-weth assets sent to admin is pct amount
          // make sure eth sent to fee distributor (the amount they deserve +/- something)
          // make sure fee custody balance is 0 for everything
    });

    it("it recovers single asset", async () => {
      const WETH = await ethers.getContractAt("IERC20", WETH_ADDRESS);
      let totalWETHDeposited = ASSET_DEPOSITS_OWNERS[WETH_ADDRESS][1];
      let balanceBefore = await WETH.balanceOf(feeCustody.address);
      let balanceAdminBefore = await WETH.balanceOf(await feeCustody.protocolRevenueRecipient());

      expect(balanceBefore).eq(totalWETHDeposited)

      let txn = await feeCustody
        .connect(sa.fundManager.signer)
        .recoverAsset(WETH_ADDRESS)

      let balanceAfter = await WETH.balanceOf(feeCustody.address);
      let balanceAdminAfter = await WETH.balanceOf(await feeCustody.protocolRevenueRecipient());

      expect(balanceAfter).eq(0)
      expect(balanceAdminAfter).eq(balanceAdminBefore.add(totalWETHDeposited))

      await expect(txn).to.emit(feeCustody, "RecoveredAsset").withArgs(WETH_ADDRESS);
    });

    it("it recovers multiple assets", async () => {
      let txn = await feeCustody
        .connect(sa.fundManager.signer)
        .recoverAllAssets()

      let balanceAfter = await WETH.balanceOf(feeCustody.address);
      let balanceAdminAfter = await WETH.balanceOf(await feeCustody.protocolRevenueRecipient());

      expect(balanceAfter).eq(0)
      expect(balanceAdminAfter).eq(balanceAdminBefore.add(totalWETHDeposited))

      for (let asset in ASSET_BALANCES_BEFORE) {
        const token = await ethers.getContractAt("IERC20", asset);
        let feeCustodyBalanceAfter = await token.balanceOf(feeCustody.address)
        let adminBalanceAfter = await token.balanceOf(await feeCustody.protocolRevenueRecipient())
        expect(feeCustodyBalanceAfter).eq(0)
        expect(adminBalanceAfter).eq(ASSET_BALANCES_BEFORE[asset][0].add(ASSET_BALANCES_BEFORE[asset][1]))
      }
    });
  });
});
