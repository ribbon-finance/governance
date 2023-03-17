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
  let TestERC20: ContractFactory;
  let VotingEscrow: ContractFactory;
  let PenaltyDistributor: ContractFactory;

  let mta: Contract,
    penaltyDistributor: Contract,
    votingLockup: Contract,
    sa: StandardAccounts;

  let start: BN;
  let penaltyRebateExpiry: BN;
  let rebateAddrs: string[];
  let rebates: BN[];

  before("Init contract", async () => {
    const accounts = await ethers.getSigners();
    sa = await new StandardAccounts().initAccounts(accounts);

    // Get RBN token
    TestERC20 = await ethers.getContractFactory("TestERC20");
    mta = await TestERC20.deploy(
      "Ribbon",
      "RBN",
      simpleToExactAmount(1000000000, DEFAULT_DECIMALS),
    );

    await mta.deployed();

    VotingEscrow = await ethers.getContractFactory(
      "VotingEscrow"
    );
    votingLockup = await VotingEscrow.deploy(
      mta.address,
      "Vote-escrowed RBN",
      "veRBN",
      sa.fundManager.address
    );

    await votingLockup.deployed();

    start = await getTimestamp();
    penaltyRebateExpiry = start.add(ONE_WEEK);

    rebateAddrs = [sa.dummy1.address, sa.dummy2.address, sa.dummy3.address, sa.dummy4.address, sa.dummy5.address, sa.dummy6.address]
    rebates = []

    let rebateAddrsLen = rebateAddrs.length;

    // Pad array to 1000
    for (let i = 0; i < 100 - rebateAddrsLen; i++) {
      rebateAddrs.push(ZERO_ADDRESS);
    }

    // Pad array to 1000
    for (let i = 0; i < 100; i++) {
      if(i < rebateAddrsLen){
        await rebates.push(rebateAddrsLen == rebateAddrsLen - 1 ? simpleToExactAmount(1000, DEFAULT_DECIMALS).mul(10) : simpleToExactAmount(1000, DEFAULT_DECIMALS))
        await mta.connect(sa.fundManager.signer).setBalance(rebateAddrs[i], simpleToExactAmount(1000, DEFAULT_DECIMALS))
      }else{
        rebates.push(simpleToExactAmount(0));
      }
    }

    PenaltyDistributor = await ethers.getContractFactory("PenaltyDistributor");
    penaltyDistributor = await PenaltyDistributor.deploy(
      votingLockup.address,
      start,
      mta.address,
      penaltyRebateExpiry,
      sa.fundManager.address,
      sa.fundManager.address
    );

    await penaltyDistributor.deployed();

    await penaltyDistributor.connect(sa.fundManager.signer).set_penalty_rebate_of(rebateAddrs, rebates)

    // Set reward pool for penalty distributor
    await votingLockup.connect(sa.fundManager.signer).set_reward_pool(penaltyDistributor.address);
  });

  describe("checking public variables", () => {
    it("returns voting escrow contract", async () => {
      expect(await penaltyDistributor.voting_escrow()).eq(votingLockup.address);
    });

    it("returns start time for distribution", async () => {
      expect(await penaltyDistributor.start_time()).eq(
        start.div(ONE_WEEK).mul(ONE_WEEK)
      );
    });

    it("returns fee token", async () => {
      expect(await penaltyDistributor.token()).eq(mta.address);
    });

    it("returns admin", async () => {
      expect(await penaltyDistributor.admin()).eq(sa.fundManager.address);
    });

    it("returns emergency return address", async () => {
      expect(await penaltyDistributor.emergency_return()).eq(
        sa.fundManager.address
      );
    });

    it("returns penalty rebate expiry", async () => {
      expect(await penaltyDistributor.penalty_rebate_expiry()).eq(
        penaltyRebateExpiry
      );
    });

    it("returns correct penalty rebates", async () => {
      for (let i = 0; i < rebateAddrs.length; i++){
        expect(await penaltyDistributor.penalty_rebate_of(rebateAddrs[i])).eq(
          rebates[i]
        );
      }
    });
  });

  describe("set_penalty_rebate_expiry", () => {
    it("it reverts when not admin ", async () => {
      await expect(penaltyDistributor.connect(sa.governor.signer).set_penalty_rebate_expiry(100)).to.be.reverted;
    });

    it("it updates penalty rebate expiry when admin ", async () => {
      await expect(penaltyDistributor.connect(sa.fundManager.signer).set_penalty_rebate_expiry(100)).to.not.be.reverted;
    });
  });

  describe("donate", () => {
    it("it does not give rebate if no rebate exists", async () => {
      await mta.connect(sa.fundManager.signer).setBalance(sa.governor.address, simpleToExactAmount(1000, DEFAULT_DECIMALS))
      let balanceBefore = await mta.balanceOf(sa.governor.address);
      await mta.connect(sa.governor.signer).approve(penaltyDistributor.address, balanceBefore);
      await penaltyDistributor.connect(sa.governor.signer).donate(balanceBefore);
      let balanceAfter = await mta.balanceOf(sa.governor.address);
      expect(balanceAfter).eq(0);
    });

    it("it does not give rebate if expiry has passed", async () => {
      let balanceBefore = await mta.balanceOf(sa.dummy1.address);
      await penaltyDistributor.connect(sa.fundManager.signer).set_penalty_rebate_expiry(100);
      await mta.connect(sa.dummy1.signer).approve(penaltyDistributor.address, balanceBefore);
      await penaltyDistributor.connect(sa.dummy1.signer).donate(balanceBefore);
      let balanceAfter = await mta.balanceOf(sa.dummy1.address);
      await penaltyDistributor.connect(sa.fundManager.signer).set_penalty_rebate_expiry(penaltyRebateExpiry);
      expect(balanceAfter).eq(0);
    });

    it("it gives rebate if rebate exists", async () => {
      let balanceBefore = await mta.balanceOf(sa.dummy2.address);
      await mta.connect(sa.dummy2.signer).approve(penaltyDistributor.address, balanceBefore);
      await penaltyDistributor.connect(sa.dummy2.signer).donate(balanceBefore);
      let balanceAfter = await mta.balanceOf(sa.dummy2.address);
      expect(balanceAfter).not.equal(0);
      // Penalty rebate is set to 0
      expect(await penaltyDistributor.penalty_rebate_of(sa.dummy2.address)).equal(0);
    });

    it("it gives rebate of provided rebate if min(penalty_rebate, _amount / 2) = penalty_rebate", async () => {
      await mta.connect(sa.fundManager.signer).setBalance(sa.dummy3.address, simpleToExactAmount(1000, DEFAULT_DECIMALS).mul(10))
      let balanceBefore = await mta.balanceOf(sa.dummy3.address);
      await mta.connect(sa.dummy3.signer).approve(penaltyDistributor.address, balanceBefore);
      await penaltyDistributor.connect(sa.dummy3.signer).donate(balanceBefore);
      let balanceAfter = await mta.balanceOf(sa.dummy3.address);
      expect(balanceAfter).eq(rebates[2]);
    });

    it("it gives rebate of amount / 2 if min(penalty_rebate, amount / 2) = amount / 2", async () => {
      let balanceBefore = await mta.balanceOf(sa.dummy4.address);
      await mta.connect(sa.dummy4.signer).approve(penaltyDistributor.address, balanceBefore);

      let amt = simpleToExactAmount(100, DEFAULT_DECIMALS)
      await penaltyDistributor.connect(sa.dummy4.signer).donate(amt);

      let balanceAfter = await mta.balanceOf(sa.dummy4.address);

      expect(balanceBefore.sub(balanceAfter)).eq(amt.div(2));
    });

    it("it gives rebate to tx.origin", async () => {
      await mta.connect(sa.fundManager.signer).setBalance(sa.dummy5.address, simpleToExactAmount(1000, DEFAULT_DECIMALS).mul(10))
      let balanceBefore = await mta.balanceOf(sa.dummy5.address);
      await mta.connect(sa.dummy5.signer).approve(votingLockup.address, balanceBefore);
      let inTwoYears = (await getTimestamp()).add(ONE_WEEK.mul(52).mul(2));
      await votingLockup.connect(sa.dummy5.signer).create_lock(balanceBefore, inTwoYears);
      await votingLockup.connect(sa.dummy5.signer).force_withdraw();

      let balanceAfterUnlock = await mta.balanceOf(sa.dummy5.address);
      // 25% returned immediately for 2 year lock
      let nonPenaltyAmountAfterUnlock = balanceBefore.mul(25).div(100)
      let rebateAfterUnlock = rebates[4] // rebate also returned

      expect(balanceAfterUnlock).eq(nonPenaltyAmountAfterUnlock.add(rebateAfterUnlock));
    });

    it("it gives 50% penalty-free unlock to tx.origin", async () => {
      await mta.connect(sa.fundManager.signer).setBalance(sa.dummy6.address, simpleToExactAmount(1000, DEFAULT_DECIMALS))
      let balanceBefore = await mta.balanceOf(sa.dummy6.address);
      await mta.connect(sa.dummy6.signer).approve(votingLockup.address, balanceBefore);
      let inTwoYears = (await getTimestamp()).add(ONE_WEEK.mul(52).mul(2));
      await votingLockup.connect(sa.dummy6.signer).create_lock(balanceBefore, inTwoYears);
      await votingLockup.connect(sa.dummy6.signer).force_withdraw();
      let balanceAfterUnlock = await mta.balanceOf(sa.dummy6.address);
      // 25% returned immediately for 2 year lock
      let nonPenaltyAmountAfterUnlock = balanceBefore.mul(25).div(100)
      // 50% of 75% penalty returned
      let rebateAfterUnlock = simpleToExactAmount(750, DEFAULT_DECIMALS).div(2)

      // 50% penalty-free unlock of 100% + 25% unlock of 50%
      let originalCalc = balanceBefore.div(2).add(nonPenaltyAmountAfterUnlock.div(2))
      // 25% unlock of 100% + 50% rebate of 75% penalty of 100%
      let newCalc = nonPenaltyAmountAfterUnlock.add(rebateAfterUnlock)

      expect(originalCalc).eq(newCalc);
      expect(balanceAfterUnlock).eq(nonPenaltyAmountAfterUnlock.add(rebateAfterUnlock));
    });
  });
});
