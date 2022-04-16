/* eslint-disable @typescript-eslint/dot-notation */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/naming-convention */

import { Contract, ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import { solidity } from "ethereum-waffle";
import {
  getTimestamp,
  takeSnapshot,
  increaseTime,
  revertToSnapShot,
} from "../utils/time";
import { addSnapshotBeforeRestoreAfterEach } from "../common";
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
  RBN,
  RBN_OWNER_ADDRESS,
  RSTETH_THETA_GAUGE,
  RSTETH_THETA_GAUGE_OWNER_ADDRESS,
  RBN_MINTER,
  BORROWER_PCT,
} from "../utils/constants";
chai.use(solidity);

describe("Fuse Pool", () => {
  let CErc20: ContractFactory;
  let RewardsDistributorDelegate: ContractFactory;

  let cErc20: Contract,
    rewardsDistributorDelegate: Contract,
    sa: StandardAccounts;

  addSnapshotBeforeRestoreAfterEach();

  before("Init contract", async () => {
    // Reset block
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: TEST_URI,
            blockNumber: 14519500,
          },
        },
      ],
    });

    const accounts = await ethers.getSigners();
    sa = await new StandardAccounts().initAccounts(accounts);

    CErc20 = await ethers.getContractFactory("CErc20");
    RewardsDistributorDelegate = await ethers.getContractFactory(
      "RewardsDistributorDelegate"
    );

    cErc20 = await CErc20.deploy(sa.fundManager.address);

    await cErc20.deployed();

    rewardsDistributorDelegate = await RewardsDistributorDelegate.deploy(
      sa.fundManager.address
    );

    await rewardsDistributorDelegate.deployed();
  });

  describe("CErc20: checking public variables", () => {
    it("returns admin", async () => {
      expect(await cErc20.admin()).eq(sa.fundManager.address);
    });

    it("returns RBN_MINTER", async () => {
      expect(await cErc20.RBN_MINTER()).eq(RBN_MINTER);
    });

    it("returns RBN", async () => {
      expect(await cErc20.RBN()).eq(RBN);
    });

    it("returns underlying", async () => {
      expect(await cErc20.underlying()).eq(RSTETH_THETA_GAUGE);
    });
  });

  describe("RewardsDistributorDelegate: checking public variables", () => {
    it("returns admin", async () => {
      expect(await rewardsDistributorDelegate.admin()).eq(
        sa.fundManager.address
      );
    });

    it("returns isRewardsDistributor", async () => {
      expect(await rewardsDistributorDelegate.isRewardsDistributor()).eq(true);
    });

    it("returns WEEK", async () => {
      expect(await rewardsDistributorDelegate.WEEK()).eq(ONE_WEEK);
    });

    it("returns AVG_BLOCKS_PER_WEEK", async () => {
      expect(await rewardsDistributorDelegate.WEEK()).eq(
        BigNumber.from(604800).div(13)
      );
    });

    it("returns TOTAL_PCT", async () => {
      expect(await rewardsDistributorDelegate.TOTAL_PCT()).eq(10000);
    });

    it("returns lastEpochTotalMint", async () => {
      expect(await rewardsDistributorDelegate.lastEpochTotalMint()).eq(0);
    });

    it("returns totalMint", async () => {
      expect(await rewardsDistributorDelegate.totalMint()).eq(0);
    });
  });

  describe("CErc20: Admin Permissions", () => {
    it("it reverts when non-admin calls _setRewardsDistributor", async () => {
      await expect(
        cErc20
          .connect(sa.fundManager2.signer)
          ._setRewardsDistributor(rewardsDistributorDelegate.address)
      ).to.be.revertedWith(
        "only the admin may set the rewards distributor delegate"
      );
    });
  });

  describe("RewardsDistributorDelegate: Admin Permissions", () => {
    it("it reverts when non-admin calls initialize", async () => {
      await expect(
        rewardsDistributorDelegate
          .connect(sa.fundManager2.signer)
          .initialize(RSTETH_THETA_GAUGE)
      ).to.be.revertedWith("Only admin can initialize.");
    });

    it("it reverts when non-admin calls _setBorrowerPCT", async () => {
      await expect(
        rewardsDistributorDelegate
          .connect(sa.fundManager2.signer)
          ._setBorrowerPCT(BORROWER_PCT)
      ).to.be.revertedWith("only admin can set borrower percent");
    });
  });

  describe("CErc20: mutative", () => {
    beforeEach(async () => {
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [RSTETH_THETA_GAUGE_OWNER_ADDRESS],
      });
      const owner = await ethers.provider.getSigner(
        RSTETH_THETA_GAUGE_OWNER_ADDRESS
      );

      const token = await ethers.getContractAt("IERC20", RSTETH_THETA_GAUGE);
      await token
        .connect(owner)
        .transfer(
          cErc20.address,
          BigNumber.from(22).mul(BigNumber.from(10).pow(18))
        );
    });

    it("it reverts when passed rewardsDistributor is ZERO_ADDRESS", async () => {
      await expect(
        cErc20
          .connect(sa.fundManager.signer)
          ._setRewardsDistributor(ZERO_ADDRESS)
      ).to.be.revertedWith("rewards distributor must be set");
    });

    it("it initializes", async () => {
      await cErc20.initialize(RSTETH_THETA_GAUGE);
      expect(await cErc20.underlying()).eq(RSTETH_THETA_GAUGE);
    });

    it("it reverts when rewardsDistributor is ZERO_ADDRESS", async () => {
      await expect(cErc20.claimGaugeRewards()).to.be.revertedWith(
        "rewards distributor must be set"
      );
    });

    it("it sets rewardsDistributor", async () => {
      await cErc20._setRewardsDistributor(rewardsDistributorDelegate.address);
      expect(await cErc20.rewardsDistributor()).eq(
        rewardsDistributorDelegate.address
      );
    });

    it("it mints 0 RBN", async () => {
      await cErc20.initialize(RSTETH_THETA_GAUGE);
      await cErc20._setRewardsDistributor(rewardsDistributorDelegate.address);
      await rewardsDistributorDelegate.initialize(
        RBN,
        await getTimestamp(),
        BORROWER_PCT
      );
      await cErc20.claimGaugeRewards();

      const token = await ethers.getContractAt("IERC20", RBN);

      expect(await token.balanceOf(cErc20.address)).eq(0);
      expect(await rewardsDistributorDelegate.totalMint()).eq(0);
    });

    it("it mints RBN and transfers to rewardsDistributorDelegate", async () => {
      await cErc20.initialize(RSTETH_THETA_GAUGE);
      await cErc20._setRewardsDistributor(rewardsDistributorDelegate.address);
      await rewardsDistributorDelegate.initialize(
        RBN,
        await getTimestamp(),
        BORROWER_PCT
      );
      await increaseTime(ONE_WEEK);
      await cErc20.claimGaugeRewards();

      const token = await ethers.getContractAt("IERC20", RBN);
      let rewardsDistributorDelegateBal = await token.balanceOf(
        rewardsDistributorDelegate.address
      );

      expect(rewardsDistributorDelegateBal).to.be.above(0);
      expect(await rewardsDistributorDelegate.totalMint()).eq(
        rewardsDistributorDelegateBal
      );
      expect(await token.balanceOf(cErc20.address)).eq(0);
    });
  });

  describe("RewardsDistributorDelegate: mutative", () => {
    beforeEach(async () => {
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [RSTETH_THETA_GAUGE_OWNER_ADDRESS],
      });
      const owner = await ethers.provider.getSigner(
        RSTETH_THETA_GAUGE_OWNER_ADDRESS
      );

      const token = await ethers.getContractAt("IERC20", RSTETH_THETA_GAUGE);
      await token
        .connect(owner)
        .transfer(
          cErc20.address,
          BigNumber.from(22).mul(BigNumber.from(10).pow(18))
        );
    });

    it("it reverts when initialize called with invalid params", async () => {
      expect(
        await rewardsDistributorDelegate.initialize(RBN, 0, BORROWER_PCT)
      ).to.be.revertedWith("Cannot initialize start time to the zero address.");
    });

    it("it initializes", async () => {
      let startTime = await getTimestamp();
      await rewardsDistributorDelegate.initialize(RBN, startTime, BORROWER_PCT);
      expect(await rewardsDistributorDelegate.rewardToken()).eq(RBN);
      expect(await rewardsDistributorDelegate.startTime()).eq(startTime);
      expect(await rewardsDistributorDelegate.borrowerPCT()).eq(BORROWER_PCT);
      expect(await rewardsDistributorDelegate.supplierPCT()).eq(
        (await rewardsDistributorDelegate.TOTAL_PCT()).sub(
          await rewardsDistributorDelegate.borrowerPCT()
        )
      );
    });

    it("it sets BORROWER_PCT", async () => {
      await rewardsDistributorDelegate._setBorrowerPCT(
        BigNumber.from(BORROWER_PCT).div(2)
      );
      expect(await rewardsDistributorDelegate.supplierPCT()).eq(
        (await rewardsDistributorDelegate.TOTAL_PCT()).sub(
          await rewardsDistributorDelegate.borrowerPCT()
        )
      );
    });

    it("it reverts when updating speed before WEEK elapsed", async () => {
      await rewardsDistributorDelegate.initialize(
        RBN,
        await getTimestamp(),
        BORROWER_PCT
      );
      expect(
        await rewardsDistributorDelegate.updateSpeedWithNewEpoch(cErc20.address)
      ).to.be.revertedWith("Must be at least week since latest epoch");
    });

    it("it updates speed of new epoch", async () => {
      await cErc20.initialize(RSTETH_THETA_GAUGE);
      await cErc20._setRewardsDistributor(rewardsDistributorDelegate.address);
      await rewardsDistributorDelegate.initialize(
        RBN,
        await getTimestamp(),
        BORROWER_PCT
      );
      await increaseTime(ONE_WEEK);
      await cErc20.claimGaugeRewards();

      const token = await ethers.getContractAt("IERC20", RBN);
      let rewardsDistributorDelegateBal = await token.balanceOf(
        rewardsDistributorDelegate.address
      );

      let prevStartTime = await rewardsDistributorDelegate.startTime();
      let totalMint = await rewardsDistributorDelegate.totalMint();
      let lastEpochTotalMint =
        await rewardsDistributorDelegate.lastEpochTotalMint();

      let totalToDistribute = totalMint
        .sub(lastEpochTotalMint)
        .div(await rewardsDistributorDelegate.AVG_BLOCKS_PER_WEEK());
      let toDistributeToBorrower = toDistribute
        .mul(await rewardsDistributorDelegate.borrowerPCT())
        .div(await rewardsDistributorDelegate.TOTAL_PCT());
      let toDistributeToSupplier = totalToDistribute.sub(
        toDistributeToBorrower
      );

      await rewardsDistributorDelegate.updateSpeedWithNewEpoch(cErc20.address);

      expect(lastEpochTotalMint).eq(0);
      expect(totalMint).eq(rewardsDistributorDelegateBal);
      expect(await rewardsDistributorDelegate.startTime()).eq(
        prevStartTime.add(ONE_WEEK)
      );
      expect(
        await rewardsDistributorDelegate.compSupplySpeeds(cErc20.address)
      ).eq(toDistributeToSupplier);
      expect(
        await rewardsDistributorDelegate.compBorrowSpeeds(cErc20.address)
      ).eq(toDistributeToBorrower);
    });

    it("it updates speed of new epoch twice", async () => {
      await cErc20.initialize(RSTETH_THETA_GAUGE);
      await cErc20._setRewardsDistributor(rewardsDistributorDelegate.address);
      await rewardsDistributorDelegate.initialize(
        RBN,
        await getTimestamp(),
        BORROWER_PCT
      );
      await increaseTime(ONE_WEEK);
      await cErc20.claimGaugeRewards();

      await rewardsDistributorDelegate.updateSpeedWithNewEpoch(cErc20.address);

      const token = await ethers.getContractAt("IERC20", RBN);
      let rewardsDistributorDelegateBal = await token.balanceOf(
        rewardsDistributorDelegate.address
      );

      let totalMint = await rewardsDistributorDelegate.totalMint();

      await increaseTime(ONE_WEEK);
      await cErc20.claimGaugeRewards();

      await rewardsDistributorDelegate.updateSpeedWithNewEpoch(cErc20.address);

      expect(lastEpochTotalMint).eq(totalMint);

      let prevStartTime = await rewardsDistributorDelegate.startTime();
      let totalMint = await rewardsDistributorDelegate.totalMint();
      let lastEpochTotalMint =
        await rewardsDistributorDelegate.lastEpochTotalMint();

      let totalToDistribute = totalMint
        .sub(lastEpochTotalMint)
        .div(await rewardsDistributorDelegate.AVG_BLOCKS_PER_WEEK());
      let toDistributeToBorrower = toDistribute
        .mul(await rewardsDistributorDelegate.borrowerPCT())
        .div(await rewardsDistributorDelegate.TOTAL_PCT());
      let toDistributeToSupplier = totalToDistribute.sub(
        toDistributeToBorrower
      );

      expect(totalMint).to.be.above(rewardsDistributorDelegateBal);
      expect(await rewardsDistributorDelegate.startTime()).eq(
        prevStartTime.add(ONE_WEEK)
      );
      expect(
        await rewardsDistributorDelegate.compSupplySpeeds(cErc20.address)
      ).eq(toDistributeToSupplier);
      expect(
        await rewardsDistributorDelegate.compBorrowSpeeds(cErc20.address)
      ).eq(toDistributeToBorrower);
    });

    it("it burns RBN", async () => {
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [RBN_OWNER_ADDRESS],
      });
      const owner = await ethers.provider.getSigner(RBN_OWNER_ADDRESS);

      const token = await ethers.getContractAt("IERC20", RBN);
      let amountToBurn = BigNumber.from(22).mul(BigNumber.from(10).pow(18));

      await token
        .connect(owner)
        .approve(rewardsDistributorDelegate.address, amountToBurn);
      await rewardsDistributorDelegate.connect(owner).burn(amountToBurn);
      expect(await token.balanceOf(rewardsDistributorDelegate.address)).eq(
        amountToBurn
      );
      expect(await rewardsDistributorDelegate.totalMint()).eq(amountToBurn);
    });
  });
});
