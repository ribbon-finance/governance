/* eslint-disable @typescript-eslint/dot-notation */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/naming-convention */

import { Contract, ContractFactory } from "@ethersproject/contracts";
import chai, { expect } from "chai";
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import { getTimestamp } from "../utils/time";
import { BN, simpleToExactAmount } from "../utils/math";
import { StandardAccounts } from "../utils/machines";
import { Account } from "../../types";
import { addSnapshotBeforeRestoreAfterEach } from "../common";
import {
  ONE_WEEK,
  ONE_YEAR,
  DEFAULT_DECIMALS,
  ZERO_ADDRESS,
  DEAD_ADDRESS,
} from "../utils/constants";
chai.use(solidity);

// In addition to original curve team testing of Gauge Controller here:
// https://github.com/curvefi/curve-dao-contracts/tree/master/tests/integration/GaugeController
describe("Gauge Controller", () => {
  let RibbonToken: ContractFactory;
  let IncentivisedVotingLockup: ContractFactory;
  let GysrStakingRewards: ContractFactory;
  let GaugeController: ContractFactory;

  let mta: Contract,
    gysrStakingRewards: Contract,
    gysrStakingRewards2: Contract,
    gysrStakingRewards3: Contract,
    votingLockup: Contract,
    gaugeController: Contract,
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

    IncentivisedVotingLockup = await ethers.getContractFactory(
      "IncentivisedVotingLockup"
    );
    votingLockup = await IncentivisedVotingLockup.deploy(
      mta.address,
      sa.fundManager.address,
      DEAD_ADDRESS
    );

    await votingLockup.deployed();

    // Get gysr staking rewards contract
    GysrStakingRewards = await ethers.getContractFactory(
      "ERC20CompetitiveRewardModule"
    );
    gysrStakingRewards = await GysrStakingRewards.connect(
      sa.fundManager.signer
    ).deploy(mta.address, 0, 1, ONE_WEEK, ZERO_ADDRESS);
    gysrStakingRewards2 = await GysrStakingRewards.connect(
      sa.fundManager.signer
    ).deploy(mta.address, 0, 1, ONE_WEEK, ZERO_ADDRESS);
    gysrStakingRewards3 = await GysrStakingRewards.connect(
      sa.fundManager.signer
    ).deploy(mta.address, 0, 1, ONE_WEEK, ZERO_ADDRESS);

    await gysrStakingRewards.deployed();
    await gysrStakingRewards2.deployed();
    await gysrStakingRewards3.deployed();

    // Get gauge controller
    GaugeController = await ethers.getContractFactory("GaugeController");
    gaugeController = await GaugeController.deploy(
      mta.address,
      votingLockup.address,
      sa.fundManager.address
    );

    await gaugeController.deployed();

    start = await getTimestamp();
  });

  describe("checking public variables", () => {
    it("returns admin", async () => {
      expect(await gaugeController.admin()).eq(sa.fundManager.address);
    });
  });

  describe("disperse funds", () => {
    let alice: Account;
    let bob: Account;

    before(async () => {
      alice = sa.default;
      bob = sa.dummy1;
      const stakeAmt1 = simpleToExactAmount(10, DEFAULT_DECIMALS);
      await mta
        .connect(sa.fundManager.signer)
        .transfer(alice.address, simpleToExactAmount(1, 22));
      await mta
        .connect(sa.fundManager.signer)
        .transfer(bob.address, simpleToExactAmount(1, 22));
      await mta
        .connect(alice.signer)
        .approve(votingLockup.address, simpleToExactAmount(100, 21));
      await mta
        .connect(bob.signer)
        .approve(votingLockup.address, simpleToExactAmount(100, 21));

      // Transfer funding abilities to gauge controller
      await gysrStakingRewards
        .connect(sa.fundManager.signer)
        .transferControl(gaugeController.address);
      await gysrStakingRewards2
        .connect(sa.fundManager.signer)
        .transferControl(gaugeController.address);
      await gysrStakingRewards3
        .connect(sa.fundManager.signer)
        .transferControl(gaugeController.address);
      // await gysrStakingRewards
      //   .connect(sa.fundManager.signer)
      //   .stake(sa.fundManager.address, [], []);
      //   await gysrStakingRewards2
      //     .connect(sa.fundManager.signer)
      //     .stake(sa.fundManager.address, ZERO_ADDRESS, 1, "0x");
      //     await gysrStakingRewards3
      //       .connect(sa.fundManager.signer)
      //       .stake(sa.fundManager.address, ZERO_ADDRESS, 1, "0xs");

      // Lock in rbn for sRBN to be used in gauge controller voting
      await votingLockup
        .connect(alice.signer)
        .createLock(stakeAmt1, start.add(ONE_YEAR));
      await votingLockup
        .connect(bob.signer)
        .createLock(stakeAmt1, start.add(ONE_YEAR));

      // Add gauge type with weight = 1.0
      await gaugeController
        .connect(sa.fundManager.signer)
        ["add_type(string,uint256)"](
          "Liquidity",
          simpleToExactAmount(10, DEFAULT_DECIMALS)
        );

      // Add two gauges with type = 0 (weight = 1.0) for two
      // different ribbon vault deposit staking contracts (ex: eth and btc)
      await gaugeController
        .connect(sa.fundManager.signer)
        ["add_gauge(address,int128)"](gysrStakingRewards.address, 0);
      await gaugeController
        .connect(sa.fundManager.signer)
        ["add_gauge(address,int128)"](gysrStakingRewards2.address, 0);

      // Alice puts 100% weight in first gauge (ex: eth vault)
      await gaugeController
        .connect(alice.signer)
        .vote_for_gauge_weights(gysrStakingRewards.address, 10000);
      // Bob puts 100% weight in second gauge (ex: btc vault)
      await gaugeController
        .connect(bob.signer)
        .vote_for_gauge_weights(gysrStakingRewards2.address, 10000);
    });

    addSnapshotBeforeRestoreAfterEach();

    it("it reverts when not admin", async () => {
      await expect(
        gaugeController.connect(alice.signer)["disperse_funds(uint256)"](0)
      ).to.be.reverted;
    });

    it("it reverts when providing 0 funding", async () => {
      await expect(
        gaugeController
          .connect(sa.fundManager.signer)
          ["disperse_funds(uint256)"](0)
      ).to.be.revertedWith("Funding must be non-zero!");
    });

    it("funds gysr staking contracts", async () => {
      let totalFundingAmt = simpleToExactAmount(10, DEFAULT_DECIMALS);

      let gysrStakingRewardsBeforeBal = await mta.balanceOf(
        gysrStakingRewards.address
      );
      let gysrStakingRewards2BeforeBal = await mta.balanceOf(
        gysrStakingRewards2.address
      );
      let fundManagerBeforeBal = await mta.balanceOf(sa.fundManager.address);

      await mta
        .connect(sa.fundManager.signer)
        .approve(gaugeController.address, totalFundingAmt);

      const tx = await gaugeController
        .connect(sa.fundManager.signer)
        ["disperse_funds(uint256)"](totalFundingAmt);

      await expect(tx)
        .to.emit(gaugeController, "DisperseTotalFunds")
        .withArgs(totalFundingAmt);

      let gysrStakingRewardsAfterBal = await mta.balanceOf(
        gysrStakingRewards.address
      );
      let gysrStakingRewards2AfterBal = await mta.balanceOf(
        gysrStakingRewards2.address
      );
      let fundManagerAfterBal = await mta.balanceOf(sa.fundManager.address);

      expect(fundManagerBeforeBal.sub(fundManagerAfterBal)).eq(totalFundingAmt);

      // Rewards for each gauge should be 50% of total funding
      // since alice and bob respectively allocated 100% of their
      // equal voting power to opposite gauges
      expect(gysrStakingRewardsAfterBal.sub(gysrStakingRewardsBeforeBal)).eq(
        totalFundingAmt.div(2))
      expect(gysrStakingRewards2AfterBal.sub(gysrStakingRewards2BeforeBal)).eq(
        totalFundingAmt.div(2))
    });

    it("funds gysr staking contracts without transferFrom", async () => {
      let totalFundingAmt = simpleToExactAmount(10, DEFAULT_DECIMALS);

      // Pre-emptively transfers rbn to contract so that
      // it funds staking contracts with those funds and not
      // multisig funds
      await mta
        .connect(sa.fundManager.signer)
        .transfer(gaugeController.address, totalFundingAmt);

      let fundManagerBeforeBal = await mta.balanceOf(sa.fundManager.address);

      const tx = await gaugeController
        .connect(sa.fundManager.signer)
        ["disperse_funds(uint256)"](totalFundingAmt);

      let fundManagerAfterBal = await mta.balanceOf(sa.fundManager.address);

      expect(fundManagerAfterBal.sub(fundManagerBeforeBal)).eq(0);

      await expect(tx)
        .to.emit(gaugeController, "DisperseTotalFunds")
        .withArgs(totalFundingAmt);
    });

    it("does not fund gysr staking contract with no weight", async () => {
      let totalFundingAmt = simpleToExactAmount(10, DEFAULT_DECIMALS);

      let gysrStakingRewards3BeforeBal = await mta.balanceOf(
        gysrStakingRewards3.address
      );
      await mta
        .connect(sa.fundManager.signer)
        .approve(gaugeController.address, totalFundingAmt);
      await gaugeController
        .connect(sa.fundManager.signer)
        ["disperse_funds(uint256)"](totalFundingAmt);
      let gysrStakingRewards3AfterBal = await mta.balanceOf(
        gysrStakingRewards3.address
      );

      // Rewards for gysr 3 should be 0 because no votes were allocated towards it
      expect(gysrStakingRewards3AfterBal.sub(gysrStakingRewards3BeforeBal)).eq(
        0
      );
    });
  });
});
