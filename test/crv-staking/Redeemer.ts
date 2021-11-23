/* eslint-disable @typescript-eslint/dot-notation */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/naming-convention */

import { Contract, ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import {
  getTimestamp,
  takeSnapshot,
  revertToSnapShot,
} from "../../test-utils/time";
import { BN, simpleToExactAmount } from "../../test-utils/math";
import { StandardAccounts } from "../../test-utils/machines";
import { Account } from "../../types";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { ONE_WEEK, DEFAULT_DECIMALS } from "../../test-utils/constants";
chai.use(solidity);

describe("Redeemer", () => {
  let RibbonToken: ContractFactory;
  let IncentivisedVotingLockup: ContractFactory;
  let Redeemer: ContractFactory;

  let mta: Contract,
    redeemer: Contract,
    votingLockup: Contract,
    sa: StandardAccounts,
    maxRedeemPCT: BN;

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

    maxRedeemPCT = simpleToExactAmount(90, 2);

    // Get redeemer contract
    Redeemer = await ethers.getContractFactory("Redeemer");
    redeemer = await Redeemer.deploy(sa.fundManager.address, maxRedeemPCT);

    await redeemer.deployed();

    IncentivisedVotingLockup = await ethers.getContractFactory(
      "IncentivisedVotingLockup"
    );
    votingLockup = await IncentivisedVotingLockup.deploy(
      mta.address,
      redeemer.address,
      await mta.name(),
      await mta.symbol()
    );

    await votingLockup.deployed();
  });

  describe("checking public variables", () => {
    it("returns owner", async () => {
      expect(await redeemer.owner()).eq(sa.fundManager.address);
    });
    it("returns maxRedeemPCT", async () => {
      expect(await redeemer.maxRedeemPCT()).eq(BN.from(maxRedeemPCT));
    });
    it("returns seizerImplementation", async () => {
      expect(await redeemer.seizerImplementation()).eq(ZERO_ADDRESS);
    });
    it("returns votingEscrowContract", async () => {
      expect(await redeemer.votingEscrowContract()).eq(ZERO_ADDRESS);
    });
  });

  describe("setters", () => {
    it("it reverts when non-admin setting voting escrow contract", async () => {
      await expect(
        redeemer
          .connect(sa.default.signer)
          .setVotingEscrowContract(sa.dummy1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("it reverts when setting zero address to voting escrow contract", async () => {
      await expect(
        redeemer
          .connect(sa.fundManager.signer)
          .setVotingEscrowContract(ZERO_ADDRESS)
      ).to.be.revertedWith("votingEscrowContract is 0x0");
    });

    it("it sets voting escrow contract", async () => {
      let snapshotId = await takeSnapshot();
      await redeemer
        .connect(sa.fundManager.signer)
        .setVotingEscrowContract(sa.dummy1.address);
      expect(await redeemer.votingEscrowContract()).eq(sa.dummy1.address);
      await revertToSnapShot(snapshotId);
    });

    it("it reverts when non-admin setting seizer implementation", async () => {
      await expect(
        redeemer
          .connect(sa.default.signer)
          .setSeizerImplementation(sa.dummy1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("it does not revert when setting zero address to seizer implementation", async () => {
      await redeemer
        .connect(sa.fundManager.signer)
        .setSeizerImplementation(ZERO_ADDRESS);
    });

    it("it sets seizer implementation", async () => {
      await redeemer
        .connect(sa.fundManager.signer)
        .setSeizerImplementation(sa.dummy1.address);
      expect(await redeemer.seizerImplementation()).eq(sa.dummy1.address);
    });

    it("it reverts when non-admin setting max redeem pct", async () => {
      await expect(
        redeemer.connect(sa.default.signer).setMaxRedeemPCT(maxRedeemPCT)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("it reverts when setting max redeem pct outside of range", async () => {
      await expect(
        redeemer
          .connect(sa.fundManager.signer)
          .setMaxRedeemPCT(maxRedeemPCT.mul(2))
      ).to.be.revertedWith("maxRedeemPCT is not between 0% - 100%");
    });

    it("it sets max redeem pct", async () => {
      await redeemer
        .connect(sa.fundManager.signer)
        .setMaxRedeemPCT(maxRedeemPCT.div(2));
      expect(await redeemer.maxRedeemPCT()).eq(maxRedeemPCT.div(2));
    });
  });

  describe("seizing and administrative", () => {
    before(async () => {
      await redeemer
        .connect(sa.fundManager.signer)
        .setSeizerImplementation(ZERO_ADDRESS);
    });

    it("it reverts when non-admin redeeming rbn", async () => {
      await expect(
        redeemer.connect(sa.default.signer).redeemRBN(maxRedeemPCT.div(2))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("it reverts when voting escrow contract is zero address", async () => {
      await expect(
        redeemer.connect(sa.fundManager.signer).redeemRBN(maxRedeemPCT.div(2))
      ).to.be.revertedWith("votingEscrowContract is 0x0");
    });
    it("it reverts when trying to redeem less than available", async () => {
      await redeemer
        .connect(sa.fundManager.signer)
        .setVotingEscrowContract(votingLockup.address);
      let stakeAmt1 = simpleToExactAmount(10, DEFAULT_DECIMALS);

      await mta
        .connect(sa.fundManager.signer)
        .approve(votingLockup.address, stakeAmt1);
      await votingLockup
        .connect(sa.fundManager.signer)
        .createLock(stakeAmt1, (await getTimestamp()).add(ONE_WEEK.add(1)));

      await expect(
        redeemer.connect(sa.fundManager.signer).redeemRBN(stakeAmt1)
      ).to.be.revertedWith(
        "Amount to redeem must be less than max redeem pct!"
      );
    });

    it("it seizes rbn", async () => {
      await redeemer
        .connect(sa.fundManager.signer)
        .setVotingEscrowContract(votingLockup.address);
      await redeemer
        .connect(sa.fundManager.signer)
        .setVotingEscrowContract(votingLockup.address);
      let stakeAmt1 = simpleToExactAmount(10, DEFAULT_DECIMALS);
      let amountToSeize = stakeAmt1
        .mul(await redeemer.maxRedeemPCT())
        .div(simpleToExactAmount(100, 2));

      await mta
        .connect(sa.fundManager.signer)
        .approve(votingLockup.address, stakeAmt1);
      await votingLockup
        .connect(sa.fundManager.signer)
        .increaseLockAmount(stakeAmt1);

      const redeemerRBNBalanceBefore = await mta.balanceOf(redeemer.address);
      await redeemer.connect(sa.fundManager.signer).redeemRBN(amountToSeize);
      const redeemerRBNBalanceAfter = await mta.balanceOf(redeemer.address);

      expect(redeemerRBNBalanceAfter).eq(
        redeemerRBNBalanceBefore.add(amountToSeize)
      );
    });

    it("it sends to admin", async () => {
      let amountToSend = simpleToExactAmount(1000, DEFAULT_DECIMALS);
      await mta
        .connect(sa.fundManager.signer)
        .transfer(redeemer.address, amountToSend);
      const redeemerRBNBalanceBefore = await mta.balanceOf(redeemer.address);
      const ownerRBNBalanceBefore = await mta.balanceOf(redeemer.owner());
      await redeemer
        .connect(sa.fundManager.signer)
        .sendToAdmin(mta.address, amountToSend);
      const redeemerRBNBalanceAfter = await mta.balanceOf(redeemer.address);
      const ownerRBNBalanceAfter = await mta.balanceOf(redeemer.owner());

      expect(redeemerRBNBalanceAfter).eq(
        redeemerRBNBalanceBefore.sub(amountToSend)
      );
      expect(ownerRBNBalanceAfter).eq(ownerRBNBalanceBefore.add(amountToSend));
    });

    it.skip("sells and disperses funds", async () => {});
  });
});
