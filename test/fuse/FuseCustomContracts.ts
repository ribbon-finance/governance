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
            blockNumber: 14459500,
          },
        },
      ],
    });

    const accounts = await ethers.getSigners();
    sa = await new StandardAccounts().initAccounts(accounts);

    CErc20 = await ethers.getContractFactory("TestCErc20");
    RewardsDistributorDelegate = await ethers.getContractFactory(
      "TestRewardsDistributorDelegate"
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

    it("returns TOTAL_PCT", async () => {
      expect(await rewardsDistributorDelegate.TOTAL_PCT()).eq(10000);
    });

    it("returns lastEpochTotalMint", async () => {
      expect(await rewardsDistributorDelegate.lastEpochTotalMint(RSTETH_THETA_GAUGE)).eq(0);
    });

    it("returns totalMint", async () => {
      expect(await rewardsDistributorDelegate.totalMint(RSTETH_THETA_GAUGE)).eq(0);
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
          .initialize(RSTETH_THETA_GAUGE, 0)
      ).to.be.revertedWith("Only admin can initialize.");
    });

    it("it reverts when non-admin calls _setBorrowerPCT", async () => {
      await expect(
        rewardsDistributorDelegate
          .connect(sa.fundManager2.signer)
          ._setBorrowerPCT(RSTETH_THETA_GAUGE, BORROWER_PCT)
      ).to.be.revertedWith("only admin can set borrower percent");
    });

    it("it reverts when non-admin calls _setSupplierPCT", async () => {
      await expect(
        rewardsDistributorDelegate
          .connect(sa.fundManager2.signer)
          ._setSupplierPCT(RSTETH_THETA_GAUGE, BORROWER_PCT)
      ).to.be.revertedWith("only admin can set supplier percent");
    });

    it("it reverts when non-admin calls _setAvgBlocksPerWeek", async () => {
      await expect(
        rewardsDistributorDelegate
          .connect(sa.fundManager2.signer)
          ._setAvgBlocksPerWeek(100)
      ).to.be.revertedWith("only admin can set avg blocks per week");
    });

    it("it reverts when non-admin calls _recoverAsset", async () => {
      await expect(
        rewardsDistributorDelegate
          .connect(sa.fundManager2.signer)
          ._recoverAsset(RSTETH_THETA_GAUGE, 0)
      ).to.be.revertedWith("only admin can recover asset");
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
      await cErc20.connect(sa.fundManager.signer)._setRewardsDistributor(rewardsDistributorDelegate.address);
      expect(await cErc20.rewardsDistributor()).eq(
        rewardsDistributorDelegate.address
      );
    });

    it("it mints 0 RBN", async () => {
      await cErc20.connect(sa.fundManager.signer).initialize(RSTETH_THETA_GAUGE);
      await cErc20.connect(sa.fundManager.signer)._setRewardsDistributor(rewardsDistributorDelegate.address);
      await rewardsDistributorDelegate.connect(sa.fundManager.signer).initialize(
        RBN,
        await getTimestamp()
      );

      expect(await rewardsDistributorDelegate.totalMint(RSTETH_THETA_GAUGE)).eq(0);

      await cErc20.claimGaugeRewards();
      await increaseTime(ONE_WEEK);
      rewardsDistributorDelegate.updateSpeedWithNewEpoch(cErc20.address)

      const token = await ethers.getContractAt("IERC20", RBN);

      expect(await token.balanceOf(cErc20.address)).eq(0);
      expect(await rewardsDistributorDelegate.totalMint(RSTETH_THETA_GAUGE)).eq(0);
    });

    it("it mints RBN and transfers to rewardsDistributorDelegate", async () => {
      await cErc20.connect(sa.fundManager.signer).initialize(RSTETH_THETA_GAUGE);
      await cErc20.connect(sa.fundManager.signer)._setRewardsDistributor(rewardsDistributorDelegate.address);
      await rewardsDistributorDelegate.connect(sa.fundManager.signer).initialize(
        RBN,
        await getTimestamp()
      );
      await increaseTime(ONE_WEEK);
      await cErc20.claimGaugeRewards();

      const token = await ethers.getContractAt("IERC20", RBN);
      let rewardsDistributorDelegateBal = await token.balanceOf(
        rewardsDistributorDelegate.address
      );

      rewardsDistributorDelegate.updateSpeedWithNewEpoch(cErc20.address)

      expect(rewardsDistributorDelegateBal).to.be.above(0);
      expect(await rewardsDistributorDelegate.totalMint(cErc20.address)).eq(
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
      await expect(
        rewardsDistributorDelegate.connect(sa.fundManager.signer).initialize(RBN, 0)
      ).to.be.revertedWith("Cannot initialize start time to 0.");
    });

    it("it initializes", async () => {
      let startTime = await getTimestamp();
      await rewardsDistributorDelegate.connect(sa.fundManager.signer).initialize(RBN, startTime);
      expect(await rewardsDistributorDelegate.rewardToken()).eq(RBN);
      expect(await rewardsDistributorDelegate.startTime()).eq(startTime);
      expect(await rewardsDistributorDelegate.avgBlocksPerWeek()).eq(
        BigNumber.from(604800).div(13)
      );
    });

    it("it reverts when BORROWER_PCT > TOTAL_PCT", async () => {
      await expect(
        rewardsDistributorDelegate.connect(sa.fundManager.signer)._setBorrowerPCT(
          cErc20.address, (await rewardsDistributorDelegate.TOTAL_PCT()).add(1)
        )
      ).to.be.revertedWith("Borrow + Supply PCT > 100%");
    });

    it("it reverts when SUPPLY_PCT > TOTAL_PCT", async () => {
      await expect(
        rewardsDistributorDelegate.connect(sa.fundManager.signer)._setSupplierPCT(
          cErc20.address, (await rewardsDistributorDelegate.TOTAL_PCT()).add(1)
        )
      ).to.be.revertedWith("Borrow + Supply PCT > 100%");
    });

    it("it reverts when BORROWER_PCT + SUPPLY_PCT > TOTAL_PCT (1)", async () => {
      rewardsDistributorDelegate.connect(sa.fundManager.signer)._setBorrowerPCT(
        cErc20.address, await rewardsDistributorDelegate.TOTAL_PCT()
      );
      await expect(
        rewardsDistributorDelegate.connect(sa.fundManager.signer)._setSupplierPCT(
          cErc20.address, 1
        )
      ).to.be.revertedWith("Borrow + Supply PCT > 100%");
    });

    it("it reverts when BORROWER_PCT + SUPPLY_PCT > TOTAL_PCT (2)", async () => {
      rewardsDistributorDelegate.connect(sa.fundManager.signer)._setSupplierPCT(
        cErc20.address, await rewardsDistributorDelegate.TOTAL_PCT()
      );
      await expect(
        rewardsDistributorDelegate.connect(sa.fundManager.signer)._setBorrowerPCT(
          cErc20.address, 1
        )
      ).to.be.revertedWith("Borrow + Supply PCT > 100%");
    });

    it("it reverts when BORROWER_PCT > TOTAL_PCT", async () => {
      await expect(
        rewardsDistributorDelegate.connect(sa.fundManager.signer)._setBorrowerPCT(
          cErc20.address, (await rewardsDistributorDelegate.TOTAL_PCT()).add(1)
        )
      ).to.be.revertedWith("Borrow + Supply PCT > 100%");
    });

    it("it sets BORROWER_PCT", async () => {
      await rewardsDistributorDelegate.connect(sa.fundManager.signer)._setBorrowerPCT(
        cErc20.address, BigNumber.from(BORROWER_PCT).div(2)
      );
      expect(await rewardsDistributorDelegate.borrowerPCT(cErc20.address)).eq(BigNumber.from(BORROWER_PCT).div(2))
    });

    it("it sets SUPPLY_PCT", async () => {
      await rewardsDistributorDelegate.connect(sa.fundManager.signer)._setSupplierPCT(
        cErc20.address, BigNumber.from(BORROWER_PCT).div(2)
      );
      expect(await rewardsDistributorDelegate.supplierPCT(cErc20.address)).eq(BigNumber.from(BORROWER_PCT).div(2))
    });

    it("it reverts when updating speed before WEEK elapsed", async () => {
      await rewardsDistributorDelegate.connect(sa.fundManager.signer).initialize(
        RBN,
        await getTimestamp()
      );
      await expect(
        rewardsDistributorDelegate.updateSpeedWithNewEpoch(cErc20.address)
      ).to.be.revertedWith("Must be at least week since latest epoch");
    });

    it("it recovers asset", async () => {
      await cErc20.connect(sa.fundManager.signer).initialize(RSTETH_THETA_GAUGE);
      await cErc20.connect(sa.fundManager.signer)._setRewardsDistributor(rewardsDistributorDelegate.address);
      await rewardsDistributorDelegate.connect(sa.fundManager.signer).initialize(
        RBN,
        await getTimestamp()
      );

      await increaseTime(ONE_WEEK);
      await cErc20.claimGaugeRewards();

      const token = await ethers.getContractAt("IERC20", RBN);

      let rewardsDistributorDelegateBal = await token.balanceOf(
        rewardsDistributorDelegate.address
      );

      await rewardsDistributorDelegate.connect(sa.fundManager.signer)._recoverAsset(RBN, rewardsDistributorDelegateBal)

      expect(await token.balanceOf(
        sa.fundManager.address
      )).eq(rewardsDistributorDelegateBal)

      expect(await token.balanceOf(
        rewardsDistributorDelegate.address
      )).eq(0)
    });

    it("it updates speed of new epoch", async () => {
      await cErc20.connect(sa.fundManager.signer).initialize(RSTETH_THETA_GAUGE);
      await cErc20.connect(sa.fundManager.signer)._setRewardsDistributor(rewardsDistributorDelegate.address);
      await rewardsDistributorDelegate.connect(sa.fundManager.signer).initialize(
        RBN,
        await getTimestamp()
      );

      await rewardsDistributorDelegate.connect(sa.fundManager.signer)._setBorrowerPCT(
        cErc20.address, BigNumber.from(BORROWER_PCT).div(2)
      );
      await rewardsDistributorDelegate.connect(sa.fundManager.signer)._setSupplierPCT(
        cErc20.address, BORROWER_PCT
      );
      await increaseTime(ONE_WEEK);
      await cErc20.claimGaugeRewards();

      const token = await ethers.getContractAt("IERC20", RBN);
      let rewardsDistributorDelegateBal = await token.balanceOf(
        rewardsDistributorDelegate.address
      );

      let prevStartTime = await rewardsDistributorDelegate.startTime();
      let lastEpochTotalMint =
        await rewardsDistributorDelegate.lastEpochTotalMint(cErc20.address);

      await rewardsDistributorDelegate.updateSpeedWithNewEpoch(cErc20.address);

      let totalMint =
        await rewardsDistributorDelegate.totalMint(cErc20.address)

      let totalToDistribute = (await rewardsDistributorDelegate.totalMint(cErc20.address))
        .sub(lastEpochTotalMint)
        .div(await rewardsDistributorDelegate.avgBlocksPerWeek());
      let toDistributeToBorrower = totalToDistribute
        .mul(await rewardsDistributorDelegate.borrowerPCT(cErc20.address))
        .div(await rewardsDistributorDelegate.TOTAL_PCT());
      let toDistributeToSupplier = totalToDistribute
        .mul(await rewardsDistributorDelegate.supplierPCT(cErc20.address))
        .div(await rewardsDistributorDelegate.TOTAL_PCT());


      expect(lastEpochTotalMint).eq(0);
      expect(totalMint).eq(rewardsDistributorDelegateBal);
      expect(await rewardsDistributorDelegate.startTime()).eq(
        prevStartTime.add(ONE_WEEK)
      );
      expect(
        await rewardsDistributorDelegate.compBorrowSpeeds(cErc20.address)
      ).eq(toDistributeToBorrower);
      expect(
        await rewardsDistributorDelegate.compSupplySpeeds(cErc20.address)
      ).eq(toDistributeToSupplier);
    });

    it("it updates speed of new epoch twice", async () => {
      await cErc20.connect(sa.fundManager.signer).initialize(RSTETH_THETA_GAUGE);
      await cErc20.connect(sa.fundManager.signer)._setRewardsDistributor(rewardsDistributorDelegate.address);
      await rewardsDistributorDelegate.connect(sa.fundManager.signer).initialize(
        RBN,
        await getTimestamp()
      );
      await rewardsDistributorDelegate.connect(sa.fundManager.signer)._setBorrowerPCT(
        cErc20.address, BigNumber.from(BORROWER_PCT).div(2)
      );
      await rewardsDistributorDelegate.connect(sa.fundManager.signer)._setSupplierPCT(
        cErc20.address, BORROWER_PCT
      );
      await increaseTime(ONE_WEEK);
      await cErc20.claimGaugeRewards();

      await rewardsDistributorDelegate.updateSpeedWithNewEpoch(cErc20.address);

      const token = await ethers.getContractAt("IERC20", RBN);
      let rewardsDistributorDelegateBal = await token.balanceOf(
        rewardsDistributorDelegate.address
      );

      let totalMint = await rewardsDistributorDelegate.totalMint(cErc20.address);

      await increaseTime(ONE_WEEK);

      let lastEpochTotalMint =
        await rewardsDistributorDelegate.lastEpochTotalMint(cErc20.address);

      expect(lastEpochTotalMint).eq(totalMint);

      await cErc20.claimGaugeRewards();

      let prevStartTime = await rewardsDistributorDelegate.startTime();

      await rewardsDistributorDelegate.updateSpeedWithNewEpoch(cErc20.address);

      let totalMint2 = await rewardsDistributorDelegate.totalMint(cErc20.address);

      let totalToDistribute = totalMint2
        .sub(lastEpochTotalMint)
        .div(await rewardsDistributorDelegate.avgBlocksPerWeek());
      let toDistributeToBorrower = totalToDistribute
        .mul(await rewardsDistributorDelegate.borrowerPCT(cErc20.address))
        .div(await rewardsDistributorDelegate.TOTAL_PCT());
      let toDistributeToSupplier = totalToDistribute
        .mul(await rewardsDistributorDelegate.supplierPCT(cErc20.address))
        .div(await rewardsDistributorDelegate.TOTAL_PCT());

      expect(totalMint2).to.be.above(rewardsDistributorDelegateBal);
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

      await rewardsDistributorDelegate.connect(sa.fundManager.signer).initialize(
        RBN,
        1
      );

      await token
        .connect(owner)
        .approve(rewardsDistributorDelegate.address, amountToBurn);
      await rewardsDistributorDelegate.connect(owner).burn(cErc20.address, amountToBurn);
      expect(await token.balanceOf(rewardsDistributorDelegate.address)).eq(
        amountToBurn
      );
      expect(await rewardsDistributorDelegate.totalMint(cErc20.address)).eq(amountToBurn);
    });
  });
});
