/* eslint-disable @typescript-eslint/dot-notation */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/naming-convention */

import { Contract, ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import { getTimestamp, takeSnapshot, revertToSnapShot } from "../utils/time";
import { BN, simpleToExactAmount } from "../utils/math";
import { StandardAccounts } from "../utils/machines";
import { Account } from "../../types";
import { ZERO_ADDRESS } from "../utils/constants";
import { ONE_WEEK, DEFAULT_DECIMALS } from "../utils/constants";
chai.use(solidity);

describe("Fee Distributor", () => {
  let RibbonToken: ContractFactory;
  let IncentivisedVotingLockup: ContractFactory;
  let Redeemer: ContractFactory;
  let FeeDistributor: ContractFactory;

  let mta: Contract,
    redeemer: Contract,
    feeDistributor: Contract,
    votingLockup: Contract,
    sa: StandardAccounts;

  let start: BN;

  before("Init contract", async () => {
    const accounts = await ethers.getSigners();
    sa = await new StandardAccounts().initAccounts(accounts);

    // Get RBN token
    RibbonToken = await ethers.getContractFactory("RibbonToken");
    mta = await RibbonToken.deploy(
      "Ribbon",
      "RBN",
      simpleToExactAmount(1000000000, DEFAULT_DECIMALS),
      sa.fundManager.address
    );

    await mta.deployed();

    await mta.connect(sa.fundManager.signer).setTransfersAllowed(true);

    // Get redeemer contract
    Redeemer = await ethers.getContractFactory("Redeemer");
    redeemer = await Redeemer.deploy(sa.fundManager.address, 1);

    await redeemer.deployed();

    IncentivisedVotingLockup = await ethers.getContractFactory(
      "IncentivisedVotingLockup"
    );
    votingLockup = await IncentivisedVotingLockup.deploy(
      mta.address,
      sa.fundManager.address,
      redeemer.address
    );

    await votingLockup.deployed();

    start = await getTimestamp();
    FeeDistributor = await ethers.getContractFactory("FeeDistributor");
    feeDistributor = await FeeDistributor.deploy(
      votingLockup.address,
      start,
      mta.address,
      sa.fundManager.address,
      sa.fundManager.address
    );

    await feeDistributor.deployed();
  });

  describe("checking public variables", () => {
    it("returns voting escrow contract", async () => {
      expect(await feeDistributor.voting_escrow()).eq(votingLockup.address);
    });

    it("returns start time for distribution", async () => {
      expect(await feeDistributor.start_time()).eq(
        start.div(ONE_WEEK).mul(ONE_WEEK)
      );
    });

    it("returns fee token", async () => {
      expect(await feeDistributor.token()).eq(mta.address);
    });

    it("returns admin", async () => {
      expect(await feeDistributor.admin()).eq(sa.fundManager.address);
    });

    it("returns emergency return address", async () => {
      expect(await feeDistributor.emergency_return()).eq(
        sa.fundManager.address
      );
    });
  });

  describe("burns", () => {
    it("it reverts when not RBN token", async () => {
      await expect(
        feeDistributor
          .connect(sa.fundManager.signer)
          .burn(votingLockup.address, 0)
      ).to.be.reverted;
    });

    it("it reverts when 0 amount", async () => {
      await expect(
        feeDistributor.connect(sa.fundManager.signer).burn(mta.address, 0)
      ).to.be.reverted;
    });

    it("it transfers RBN token to fee distributor", async () => {
      let totalFundManagerRBNBalanceBefore = await mta.balanceOf(
        sa.fundManager.address
      );
      let totalFeeDistributorRBNBalanceBefore = await mta.balanceOf(
        feeDistributor.address
      );

      await mta
        .connect(sa.fundManager.signer)
        .approve(feeDistributor.address, totalFundManagerRBNBalanceBefore);

      await feeDistributor
        .connect(sa.fundManager.signer)
        .burn(mta.address, totalFundManagerRBNBalanceBefore);

      let totalFundManagerRBNBalanceAfter = await mta.balanceOf(
        sa.fundManager.address
      );
      let totalFeeDistributorRBNBalanceAfter = await mta.balanceOf(
        feeDistributor.address
      );

      expect(totalFundManagerRBNBalanceAfter).eq(0);
      expect(totalFeeDistributorRBNBalanceAfter).eq(
        totalFeeDistributorRBNBalanceBefore.add(
          totalFundManagerRBNBalanceBefore
        )
      );
    });
  });
});
