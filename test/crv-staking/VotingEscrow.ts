/* eslint-disable @typescript-eslint/dot-notation */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/naming-convention */

import { Contract, ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import { assertBNClose, assertBNClosePercent } from "../utils/assertions";
import { takeSnapshot, revertToSnapShot } from "../utils/time";
import { addSnapshotBeforeRestoreAfterEach } from "../common";
import {
  advanceBlock,
  getTimestamp,
  increaseTime,
  increaseTimeTo,
  latestBlock,
} from "../utils/time";
import { BN, simpleToExactAmount, maximum, sqrt } from "../utils/math";
import { StandardAccounts } from "../utils/machines";
import {
  ONE_WEEK,
  ONE_HOUR,
  ONE_DAY,
  ONE_YEAR,
  ZERO_ADDRESS,
  DEFAULT_DECIMALS,
} from "../utils/constants";
import { Account } from "../../types";

chai.use(solidity);

describe("VotingEscrow", () => {
  let RibbonToken: ContractFactory;
  let VotingEscrow: ContractFactory;

  let mta: Contract,
    votingLockup: Contract,
    sa: StandardAccounts;

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

    VotingEscrow = await ethers.getContractFactory(
      "VotingEscrow"
    );
    votingLockup = await IncentivisedVotingLockup.deploy(
      mta.address,
      "Vote-escrowed CRV",
      "veRBN",
      "veRBN_1.0.0"
    );

    await votingLockup.deployed();
  });

  const goToNextUnixWeekStart = async () => {
    const unixWeekCount = (await getTimestamp()).div(ONE_WEEK);
    const nextUnixWeek = unixWeekCount.add(1).mul(ONE_WEEK);
    await increaseTimeTo(nextUnixWeek);
  };

  const calcBias = async (amount: BN, len: BN): Promise<BN> => {
    return amount.div(await votingLockup.MAXTIME()).mul(len);
  };

  const deployFresh = async () => {
    await mta
      .connect(sa.fundManager.signer)
      .transfer(
        sa.default.address,
        simpleToExactAmount(1000, DEFAULT_DECIMALS)
      );
    await mta
      .connect(sa.fundManager.signer)
      .transfer(sa.other.address, simpleToExactAmount(1000, DEFAULT_DECIMALS));
    votingLockup = await IncentivisedVotingLockup.deploy(
      mta.address,
      sa.fundManager.address,
      redeemer.address
    );

    await votingLockup.deployed();
    await mta.approve(
      votingLockup.address,
      simpleToExactAmount(100, DEFAULT_DECIMALS)
    );
    await mta
      .connect(sa.other.signer)
      .approve(
        votingLockup.address,
        simpleToExactAmount(100, DEFAULT_DECIMALS)
      );
    await mta
      .connect(sa.fundManager.signer)
      .approve(
        votingLockup.address,
        simpleToExactAmount(10000, DEFAULT_DECIMALS)
      );
  };

  describe("checking balances & total supply", () => {
    before(async () => {
      await deployFresh();
    });
    describe("before any stakes are made", () => {
      it("returns balances", async () => {
        expect(await votingLockup.balanceOf(sa.default.address)).eq(
          BN.from(0)
        );
        expect(await votingLockup.getPriorVotes(sa.default.address, 1)).eq(
          BN.from(0)
        );
      });
      it("returns balance at latest block", async () => {
        expect(
          await votingLockup.getPriorVotes(
            sa.default.address,
            BN.from((await latestBlock()).number)
          )
        ).eq(BN.from(0));
      });
      it("returns totalSupply", async () => {
        expect(await votingLockup.totalSupply()).eq(BN.from(0));
        expect(await votingLockup.totalSupplyAt(1)).eq(BN.from(0));
      });
      it("returns totalSupply at latest block", async () => {
        expect(
          await votingLockup.totalSupplyAt(
            BN.from((await latestBlock()).number)
          )
        ).eq(BN.from(0));
      });
    });
    describe("fetching for current block", () => {
      it("fails for balanceOfAt", async () => {
        await expect(
          votingLockup.getPriorVotes(
            sa.default.address,
            BN.from((await latestBlock()).number).add(1)
          )
        ).to.be.revertedWith("Must pass block number in the past");
      });
      it("fails for supply", async () => {
        await expect(
          votingLockup.totalSupplyAt(
            BN.from((await latestBlock()).number).add(1)
          )
        ).to.be.revertedWith("Must pass block number in the past");
      });
    });
  });

  interface LockedBalance {
    amount: BN;
    shares: BN;
    end: BN;
  }

  interface Point {
    bias: BN;
    slope: BN;
    ts: BN;
    blk?: BN;
  }

  interface ContractData {
    epoch: BN;
    userEpoch: BN;
    endTime: BN;
    userLocked: LockedBalance;
    userLastPoint: Point;
    lastPoint: Point;
    totalLocked: BN;
    senderStakingTokenBalance: BN;
  }

  const snapshotData = async (sender = sa.default): Promise<ContractData> => {
    const locked = await votingLockup.locked(sender.address);
    const userLastPoint = await votingLockup.getLastUserPoint(sender.address);
    const epoch = await await votingLockup.globalEpoch();
    const userEpoch = await await votingLockup.userPointEpoch(sender.address);
    const lastPoint = await votingLockup.pointHistory(epoch);
    return {
      epoch,
      userEpoch,
      endTime: await votingLockup.END(),
      userLocked: {
        amount: locked[0],
        shares: locked[1],
        end: locked[2],
      },
      userLastPoint: {
        bias: userLastPoint[0],
        slope: userLastPoint[1],
        ts: userLastPoint[2],
      },
      lastPoint: {
        bias: lastPoint[0],
        slope: lastPoint[1],
        ts: lastPoint[2],
        blk: lastPoint[3],
      },
      totalLocked: await mta.balanceOf(votingLockup.address),
      senderStakingTokenBalance: await mta.balanceOf(sender.address),
    };
  };

  // Flow performed with 4 stakers
  // 1 - stakes 10 for a year
  // 2 - stakes 1000 for 6 months
  //   - increases time after 3 to 12m
  // 3 - stakes 10 for 6 months
  //   - increases amount after 3
  //   - gets ejected after 6m
  // 4 - stakes 10 from 3-6 mo & exits
  // 5 - stakes 10 at start for 1 week
  describe("performing full system flow", () => {
    let alice: Account;
    let bob: Account;
    let charlie: Account;
    let david: Account;
    let eve: Account;

    const stakeAmt1 = simpleToExactAmount(10, DEFAULT_DECIMALS);
    const stakeAmt2 = simpleToExactAmount(1000, DEFAULT_DECIMALS);
    let start: BN;
    let maxTime: BN;
    before(async () => {
      alice = sa.default;
      bob = sa.dummy1;
      charlie = sa.dummy2;
      david = sa.dummy3;
      eve = sa.dummy4;

      await goToNextUnixWeekStart();
      start = await getTimestamp();
      await deployFresh();
      maxTime = await votingLockup.MAXTIME();
      await mta
        .connect(sa.fundManager.signer)
        .transfer(alice.address, simpleToExactAmount(1, 22));
      await mta
        .connect(sa.fundManager.signer)
        .transfer(bob.address, simpleToExactAmount(1, 22));
      await mta
        .connect(sa.fundManager.signer)
        .transfer(charlie.address, simpleToExactAmount(1, 22));
      await mta
        .connect(sa.fundManager.signer)
        .transfer(david.address, simpleToExactAmount(1, 22));
      await mta
        .connect(sa.fundManager.signer)
        .transfer(eve.address, simpleToExactAmount(1, 22));
      await mta
        .connect(alice.signer)
        .approve(votingLockup.address, simpleToExactAmount(100, 21));
      await mta
        .connect(bob.signer)
        .approve(votingLockup.address, simpleToExactAmount(100, 21));
      await mta
        .connect(charlie.signer)
        .approve(votingLockup.address, simpleToExactAmount(100, 21));
      await mta
        .connect(david.signer)
        .approve(votingLockup.address, simpleToExactAmount(100, 21));
      await mta
        .connect(eve.signer)
        .approve(votingLockup.address, simpleToExactAmount(100, 21));
    });
    describe("checking initial settings", () => {
      it("should set END date one year in advance", async () => {
        const endTime = await votingLockup.END();
        assertBNClose(
          endTime,
          (await getTimestamp()).add(ONE_YEAR.mul(4)),
          100
        );
      });
      it("sets ERC20 details", async () => {
        const name = await votingLockup.name();
        const symbol = await votingLockup.symbol();
        const decimals = await votingLockup.decimals();
        const supply = await votingLockup.totalSupply();
        expect(name).eq("Staked Ribbon");
        expect(symbol).eq("sRBN");
        expect(decimals).eq(18);
        expect(supply).eq(BN.from(0));
      });
      it("sets redeemer details", async () => {
        const rbnRedeemer = redeemer.address;
        expect(rbnRedeemer).eq(await votingLockup.rbnRedeemer());
      });
      it("sets contract stopped details", async () => {
        const contractStopped = await votingLockup.contractStopped();
        expect(contractStopped).eq(false);
      });
    });

    describe("checking contract is stopped", () => {
      it("fails when trying to lock as non-owner", async () => {
        await expect(
          votingLockup.connect(alice.signer).setContractStopped(true)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("fails when trying to lock when contract is stopped", async () => {
        const tx = await votingLockup
          .connect(sa.fundManager.signer)
          .setContractStopped(true);
        await expect(tx)
          .to.emit(votingLockup, "ContractStopped")
          .withArgs(true);
        await expect(
          votingLockup
            .connect(alice.signer)
            .createLock(stakeAmt1, start.add(ONE_YEAR))
        ).to.be.revertedWith("Contract is stopped");
        await expect(
          votingLockup.connect(alice.signer).increaseLockAmount(stakeAmt1)
        ).to.be.revertedWith("Contract is stopped");
        await expect(
          votingLockup
            .connect(alice.signer)
            .increaseLockLength(start.add(ONE_YEAR))
        ).to.be.revertedWith("Contract is stopped");
      });

      it("locks when contract is not stopped", async () => {
        await votingLockup
          .connect(sa.fundManager.signer)
          .setContractStopped(true);
        await expect(
          votingLockup
            .connect(alice.signer)
            .createLock(stakeAmt1, start.add(ONE_YEAR))
        ).to.be.revertedWith("Contract is stopped");
        await votingLockup
          .connect(sa.fundManager.signer)
          .setContractStopped(false);
        await mta
          .connect(sa.fundManager.signer)
          .transfer(sa.questMaster.address, simpleToExactAmount(1, 22));
        await mta
          .connect(sa.questMaster.signer)
          .approve(votingLockup.address, simpleToExactAmount(100, 21));
        let snapshotId = await takeSnapshot();
        await votingLockup
          .connect(sa.questMaster.signer)
          .createLock(stakeAmt1, start.add(ONE_YEAR));
        await revertToSnapShot(snapshotId);
      });
    });

    describe("creating a lockup", () => {
      it("allows user to create a lock", async () => {
        await votingLockup
          .connect(alice.signer)
          .createLock(stakeAmt1, start.add(ONE_YEAR));
        await votingLockup
          .connect(bob.signer)
          .createLock(stakeAmt2, start.add(ONE_WEEK.mul(26)));
        await votingLockup
          .connect(charlie.signer)
          .createLock(stakeAmt1, start.add(ONE_WEEK.mul(26)));
        await votingLockup
          .connect(eve.signer)
          .createLock(stakeAmt1, start.add(ONE_WEEK));

        const aliceData = await snapshotData(alice);
        const bobData = await snapshotData(bob);
        const charlieData = await snapshotData(charlie);
        const eveData = await snapshotData(eve);

        // Bias
        assertBNClosePercent(
          aliceData.userLastPoint.bias,
          await calcBias(stakeAmt1, ONE_YEAR),
          "0.4"
        );
        assertBNClosePercent(
          bobData.userLastPoint.bias,
          await calcBias(stakeAmt2, ONE_WEEK.mul(26)),
          "0.4"
        );
        assertBNClosePercent(
          charlieData.userLastPoint.bias,
          await calcBias(stakeAmt1, ONE_WEEK.mul(26)),
          "0.4"
        );

        // Shares
        expect(aliceData.userLocked.shares).eq(stakeAmt1);
        expect(bobData.userLocked.shares).eq(stakeAmt2);
        expect(charlieData.userLocked.shares).eq(stakeAmt1);
        expect(eveData.userLocked.shares).eq(stakeAmt1);

        // Total locked
        expect(eveData.totalLocked).eq(stakeAmt1.mul(3).add(stakeAmt2));
        // Total shares
        expect(await votingLockup.totalShares()).eq(
          stakeAmt1.mul(3).add(stakeAmt2)
        );
      });

      it("rejects if the params are wrong", async () => {
        await expect(
          votingLockup
            .connect(sa.other.signer)
            .createLock(BN.from(0), start.add(ONE_WEEK))
        ).to.be.revertedWith("Must stake non zero amount");
        await expect(
          votingLockup
            .connect(alice.signer)
            .createLock(BN.from(1), start.add(ONE_WEEK))
        ).to.be.revertedWith("Withdraw old tokens first");
        await expect(
          votingLockup
            .connect(sa.other.signer)
            .createLock(BN.from(1), start.sub(ONE_WEEK))
        ).to.be.revertedWith("Can only lock until time in the future");
      });

      it("only allows creation up until END date", async () => {
        await expect(
          votingLockup
            .connect(sa.other.signer)
            .createLock(BN.from(1), start.add(ONE_YEAR.mul(4).add(ONE_WEEK)))
        ).to.be.revertedWith("Voting lock can be 4 years max");
      });
    });

    describe("extending lock", () => {
      before(async () => {
        await increaseTime(ONE_WEEK.mul(12));

        // Eves lock is now expired
      });
      describe("by amount", () => {
        it("fails if conditions are not met", async () => {
          await expect(
            votingLockup.connect(alice.signer).increaseLockAmount(BN.from(0))
          ).to.be.revertedWith("Must stake non zero amount");
          await expect(
            votingLockup.connect(sa.other.signer).increaseLockAmount(BN.from(1))
          ).to.be.revertedWith("No existing lock found");
          await expect(
            votingLockup.connect(eve.signer).increaseLockAmount(BN.from(1))
          ).to.be.revertedWith("Cannot add to expired lock. Withdraw");
        });

        it("allows someone to increase lock amount", async () => {
          const charlieSnapBefore = await snapshotData(charlie);

          await votingLockup
            .connect(charlie.signer)
            .increaseLockAmount(stakeAmt2);

          const charlieSnapAfter = await snapshotData(charlie);

          // Total locked
          expect(charlieSnapAfter.totalLocked).eq(
            charlieSnapBefore.totalLocked.add(stakeAmt2)
          );

          // Shares
          expect(charlieSnapAfter.userLocked.shares).eq(
            charlieSnapBefore.userLocked.shares.add(stakeAmt2)
          );
        });
      });

      describe("by length", () => {
        it("fails if conditions are not met", async () => {
          await expect(
            votingLockup
              .connect(eve.signer)
              .increaseLockLength((await getTimestamp()).add(ONE_WEEK))
          ).to.be.revertedWith("Lock expired");
          await expect(
            votingLockup
              .connect(david.signer)
              .increaseLockLength((await getTimestamp()).add(ONE_WEEK))
          ).to.be.revertedWith("Nothing is locked");
          await expect(
            votingLockup
              .connect(alice.signer)
              .increaseLockLength((await getTimestamp()).add(ONE_DAY))
          ).to.be.revertedWith("Can only increase lock WEEK");
          await expect(
            votingLockup
              .connect(bob.signer)
              .increaseLockLength(
                (await getTimestamp()).add(ONE_WEEK.mul(53).mul(4))
              )
          ).to.be.revertedWith("Voting lock can be 4 years max");
          await expect(
            votingLockup
              .connect(david.signer)
              .createLock(
                stakeAmt1,
                (await getTimestamp()).add(ONE_WEEK.mul(53).mul(4))
              )
          ).to.be.revertedWith("Voting lock can be 4 years max");
        });

        it("allows user to extend lock", async () => {
          await goToNextUnixWeekStart();
          const bobSnapBefore = await snapshotData(bob);
          const len = bobSnapBefore.endTime.sub(await getTimestamp());
          await votingLockup
            .connect(bob.signer)
            .increaseLockLength(start.add(ONE_YEAR.mul(4)));

          const bobSnapAfter = await snapshotData(bob);

          // Total locked
          expect(bobSnapAfter.totalLocked).eq(bobSnapBefore.totalLocked);
          // Shares
          expect(bobSnapAfter.userLocked.shares).eq(
            bobSnapBefore.userLocked.shares
          );
        });
      });
    });

    describe("trying to withdraw early or with nothing to withdraw", () => {
      it("fails", async () => {
        await expect(
          votingLockup.connect(alice.signer).withdraw()
        ).to.be.revertedWith("The lock didn't expire");
        await expect(
          votingLockup.connect(david.signer).withdraw()
        ).to.be.revertedWith("Must have something to withdraw");
      });
    });

    describe("calling public checkpoint", () => {
      // checkpoint updates point history
      it("allows anyone to call checkpoint and update the history", async () => {
        const before = await snapshotData(alice);
        await votingLockup.checkpoint();
        const after = await snapshotData(alice);

        expect(after.epoch).eq(before.epoch.add(1));

        expect(parseInt(after.lastPoint.bias.toString())).lt(
          parseInt(before.lastPoint.bias.toString())
        );
        expect(after.lastPoint.slope).eq(before.lastPoint.slope);
        expect(after.lastPoint.blk).eq(BN.from((await latestBlock()).number));
      });
    });

    describe("calling the getters", () => {
      // returns 0 if 0
      it("allows anyone to get last user point", async () => {
        const userLastPoint = await votingLockup.getLastUserPoint(
          alice.address
        );
        const e = await votingLockup.userPointEpoch(alice.address);
        const p = await votingLockup.userPointHistory(alice.address, e);
        expect(userLastPoint[0]).eq(p[0]);
        expect(userLastPoint[1]).eq(p[1]);
        expect(userLastPoint[2]).eq(p[2]);
      });
    });

    describe("exiting the system", () => {
      before(async () => {
        await votingLockup
          .connect(david.signer)
          .createLock(stakeAmt1, (await getTimestamp()).add(ONE_WEEK.mul(13)));
        await increaseTime(ONE_WEEK.mul(14));
      });
      it("allows user to withdraw", async () => {
        // david withdraws
        const davidBefore = await snapshotData(david);
        await votingLockup.connect(david.signer).withdraw();
        const davidAfter = await snapshotData(david);

        expect(davidAfter.senderStakingTokenBalance).eq(
          davidBefore.senderStakingTokenBalance.add(
            davidBefore.userLocked.amount
          )
        );

        expect(davidAfter.userLastPoint.bias).eq(BN.from(0));
        expect(davidAfter.userLastPoint.slope).eq(BN.from(0));
        expect(davidAfter.userLocked.amount).eq(BN.from(0));
        expect(davidAfter.userLocked.shares).eq(BN.from(0));
        expect(davidAfter.userLocked.end).eq(BN.from(0));
        expect(davidAfter.totalLocked).eq(
          davidBefore.totalLocked.sub(davidBefore.userLocked.amount)
        );

        await expect(
          votingLockup.connect(alice.signer).withdraw()
        ).to.be.revertedWith("The lock didn't expire");
      });
    });

    describe("checking whitelist", () => {
      it("fails when trying to commit smart wallet checker as non-owner", async () => {
        await expect(
          votingLockup
            .connect(alice.signer)
            .commitSmartWalletChecker(smartWalletWhitelist.address)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("fails when trying to approve smart wallet checker as non-owner", async () => {
        await expect(
          votingLockup.connect(alice.signer).applySmartWalletChecker()
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("sets smart wallet whitelist and applies it", async () => {
        const tx1 = await votingLockup
          .connect(sa.fundManager.signer)
          .commitSmartWalletChecker(smartWalletWhitelist.address);
        const tx2 = await votingLockup
          .connect(sa.fundManager.signer)
          .applySmartWalletChecker();
        expect(await votingLockup.futureSmartWalletChecker()).eq(
          smartWalletWhitelist.address
        );
        expect(await votingLockup.smartWalletChecker()).eq(
          smartWalletWhitelist.address
        );
      });

      it("fails when trying to lock when not on whitelist", async () => {
        await expect(
          testWrapperSC.connect(alice.signer).createLock()
        ).to.be.revertedWith("Smart contract depositors not allowed");
        await expect(
          testWrapperSC.connect(alice.signer).increaseLockAmount()
        ).to.be.revertedWith("Smart contract depositors not allowed");
        await expect(
          testWrapperSC.connect(alice.signer).increaseLockLength()
        ).to.be.revertedWith("Smart contract depositors not allowed");
      });

      it("locks when on whitelist", async () => {
        await votingLockup
          .connect(sa.fundManager.signer)
          .commitSmartWalletChecker(smartWalletWhitelist.address);
        await votingLockup
          .connect(sa.fundManager.signer)
          .applySmartWalletChecker();
        await expect(
          testWrapperSC.connect(alice.signer).createLock()
        ).to.be.revertedWith("Smart contract depositors not allowed");
        await smartWalletWhitelist
          .connect(sa.fundManager.signer)
          .approveWallet(testWrapperSC.address);
        expect(await smartWalletWhitelist.check(testWrapperSC.address)).eq(
          true
        );
        await mta
          .connect(sa.fundManager.signer)
          .transfer(testWrapperSC.address, simpleToExactAmount(1, 22));
        await testWrapperSC.connect(sa.fundManager.signer).approve(mta.address);

        await testWrapperSC.connect(sa.questMaster.signer).createLock();
        let snapshotId = await takeSnapshot();
        await testWrapperSC.connect(sa.dummy6.signer).increaseLockLength();
        await revertToSnapShot(snapshotId);
        await testWrapperSC.connect(sa.questSigner.signer).increaseLockAmount();
      });
    });
  });

  describe("allow multisig rbn redeem", () => {
    let alice: Account;
    let bob: Account;
    let david: Account;
    let charlie: Account;

    let stakeAmt1: BN;
    let stakeAmt2: BN;
    let amountToSeize: BN;

    before(async () => {
      alice = sa.mockMasset;
      bob = sa.mockRewardsDistributor;
      david = sa.mockInterestValidator;
      charlie = sa.mockRecollateraliser;

      stakeAmt1 = simpleToExactAmount(10, DEFAULT_DECIMALS);
      stakeAmt2 = simpleToExactAmount(1000, DEFAULT_DECIMALS);

      await deployFresh();

      await mta
        .connect(sa.fundManager.signer)
        .transfer(alice.address, stakeAmt1);
      await mta.connect(sa.fundManager.signer).transfer(bob.address, stakeAmt2);
      await mta
        .connect(sa.fundManager.signer)
        .transfer(david.address, stakeAmt1);
      await mta
        .connect(sa.fundManager.signer)
        .transfer(charlie.address, stakeAmt2);

      await mta.connect(alice.signer).approve(votingLockup.address, stakeAmt1);
      await mta.connect(bob.signer).approve(votingLockup.address, stakeAmt2);
      await mta.connect(david.signer).approve(votingLockup.address, stakeAmt1);
      await mta
        .connect(charlie.signer)
        .approve(votingLockup.address, stakeAmt2);

      await votingLockup
        .connect(alice.signer)
        .createLock(stakeAmt1, (await getTimestamp()).add(ONE_WEEK.add(1)));
      await votingLockup
        .connect(bob.signer)
        .createLock(stakeAmt2, (await getTimestamp()).add(ONE_WEEK.add(1)));
    });

    it("reverts on non-redeemer role", async () => {
      await expect(
        votingLockup.connect(sa.fundManager.signer).redeemRBN(1)
      ).to.be.revertedWith("Must be rbn redeemer contract");
    });

    it("reverts on too high seize amount", async () => {
      amountToSeize = simpleToExactAmount(3000, DEFAULT_DECIMALS);
      await expect(
        redeemer
          .connect(sa.fundManager.signer)
          ["redeemRBN(uint256)"](amountToSeize)
      ).to.be.revertedWith(
        "Amount to redeem must be less than max redeem pct!"
      );
    });

    it("reverts on setting new redeemer from non-owner", async () => {
      await expect(
        votingLockup.connect(alice.signer).setRBNRedeemer(ZERO_ADDRESS)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("seizes rbn", async () => {
      amountToSeize = simpleToExactAmount(500, DEFAULT_DECIMALS);

      const aliceDataBefore = await snapshotData(alice);
      const bobDataBefore = await snapshotData(bob);
      const votingLockupRBNBalanceBefore = await mta.balanceOf(
        votingLockup.address
      );
      const redeemerRBNBalanceBefore = await mta.balanceOf(redeemer.address);

      redeemer
        .connect(sa.fundManager.signer)
        ["redeemRBN(uint256)"](amountToSeize);

      const aliceDataAfter = await snapshotData(alice);
      const bobDataAfter = await snapshotData(bob);
      const votingLockupRBNBalanceAfter = await mta.balanceOf(
        votingLockup.address
      );
      const redeemerRBNBalanceAfter = await mta.balanceOf(redeemer.address);

      // Bias
      assertBNClosePercent(
        aliceDataAfter.userLastPoint.bias,
        aliceDataBefore.userLastPoint.bias,
        "0"
      );
      assertBNClosePercent(
        bobDataAfter.userLastPoint.bias,
        bobDataBefore.userLastPoint.bias,
        "0"
      );

      expect(votingLockupRBNBalanceAfter).eq(
        votingLockupRBNBalanceBefore.sub(amountToSeize)
      );
      expect(redeemerRBNBalanceAfter).eq(
        redeemerRBNBalanceBefore.add(amountToSeize)
      );

      await votingLockup
        .connect(david.signer)
        .createLock(stakeAmt1, (await getTimestamp()).add(ONE_WEEK.add(1)));
      const davidData = await snapshotData(david);
      // amount.mul(totalShares).div(totalRBN);
      let newDavidShares = stakeAmt1
        .mul(stakeAmt1.add(stakeAmt2))
        .div(stakeAmt1.add(stakeAmt2).sub(amountToSeize));

      expect(davidData.userLocked.shares).eq(newDavidShares);
      expect(davidData.userLocked.amount).eq(stakeAmt1);

      await votingLockup
        .connect(charlie.signer)
        .createLock(stakeAmt2, (await getTimestamp()).add(ONE_WEEK.add(1)));
      const charlieData = await snapshotData(charlie);
      // amount.mul(totalShares).div(totalRBN);
      let newCharlieShares = stakeAmt2
        .mul(stakeAmt1.add(stakeAmt2).add(newDavidShares))
        .div(stakeAmt1.mul(2).add(stakeAmt2).sub(amountToSeize));

      expect(charlieData.userLocked.shares).eq(newCharlieShares);
      expect(charlieData.userLocked.amount).eq(stakeAmt2);

      await increaseTime(ONE_WEEK.mul(2));

      // alice withdraws
      const aliceBefore = await snapshotData(alice);
      let aliceToWithdraw = aliceBefore.userLocked.shares
        .mul(aliceBefore.totalLocked)
        .div(await votingLockup.totalShares());

      await votingLockup.connect(alice.signer).withdraw();
      const aliceAfter = await snapshotData(alice);

      // depositAmount / 2 < alice withdraw Amount < depositAmount * 2 / 3
      // she deposited 10 rbn into total of 1010 rbn, and we withdrew 500 => 10 * (1010 - 500) / 1010

      expect(aliceToWithdraw).lt(aliceBefore.userLocked.amount.mul(2).div(3));

      expect(aliceToWithdraw).gt(aliceBefore.userLocked.amount.div(2));

      expect(aliceToWithdraw).eq(
        stakeAmt1
          .mul(stakeAmt1.add(stakeAmt2).sub(amountToSeize))
          .div(stakeAmt1.add(stakeAmt2))
      );

      expect(aliceAfter.senderStakingTokenBalance).eq(
        aliceBefore.senderStakingTokenBalance.add(aliceToWithdraw)
      );

      // david withdraws
      const davidBefore = await snapshotData(david);
      let davidToWithdraw = davidBefore.userLocked.shares
        .mul(davidBefore.totalLocked)
        .div(await votingLockup.totalShares());

      await votingLockup.connect(david.signer).withdraw();
      const davidAfter = await snapshotData(david);

      // depositAmount = bob withdraw amount
      // he deposited rbn after seize and so he received more shares
      // which equals same deposit amount

      // there is rounding error

      expect(davidBefore.userLocked.amount).eq(davidToWithdraw.add(1));

      expect(davidAfter.senderStakingTokenBalance).eq(
        davidBefore.senderStakingTokenBalance.add(davidToWithdraw)
      );
    });

    it("sets new rbn redeemer contract", async () => {
      await votingLockup
        .connect(sa.fundManager.signer)
        .setRBNRedeemer(ZERO_ADDRESS);
      await expect(await votingLockup.rbnRedeemer()).eq(ZERO_ADDRESS);
    });
  });

  // creating delegation: https://github.com/curvefi/curve-veBoost/blob/master/tests/boosts/test_create_boost.py
  // cancelling delegation: https://github.com/curvefi/curve-veBoost/blob/master/tests/boosts/test_cancel_boost.py
  describe("delegation", () => {
    let alice: Account;
    let bob: Account;
    let david: Account;
    let charlie: Account;

    let stakeAmt1: BN;
    let stakeAmt2: BN;
    let amountToSeize: BN;

    let expireTime: BN;
    let start: BN;

    addSnapshotBeforeRestoreAfterEach();

    before(async () => {
      alice = sa.mockMasset;
      bob = sa.mockRewardsDistributor;
      david = sa.mockInterestValidator;
      charlie = sa.mockRecollateraliser;

      stakeAmt1 = simpleToExactAmount(10, DEFAULT_DECIMALS);
      stakeAmt2 = simpleToExactAmount(1000, DEFAULT_DECIMALS);

      await deployFresh();

      await mta
        .connect(sa.fundManager.signer)
        .transfer(alice.address, stakeAmt2);
      await mta.connect(sa.fundManager.signer).transfer(bob.address, stakeAmt2);
      await mta
        .connect(sa.fundManager.signer)
        .transfer(david.address, stakeAmt2);
      await mta
        .connect(sa.fundManager.signer)
        .transfer(charlie.address, stakeAmt2);

      await mta.connect(alice.signer).approve(votingLockup.address, stakeAmt2);
      await mta.connect(bob.signer).approve(votingLockup.address, stakeAmt2);
      await mta.connect(david.signer).approve(votingLockup.address, stakeAmt2);
      await mta
        .connect(charlie.signer)
        .approve(votingLockup.address, stakeAmt2);

      await votingLockup
        .connect(alice.signer)
        .createLock(stakeAmt1, (await getTimestamp()).add(ONE_WEEK.add(1)));
      await votingLockup
        .connect(bob.signer)
        .createLock(stakeAmt2, (await getTimestamp()).add(ONE_WEEK.add(1)));

      start = BN.from(await getTimestamp());
      expireTime = start.add(ONE_WEEK);
    });

    it("reverts on delegation to zero-address when no prior delegation", async () => {
      await expect(
        votingLockup.connect(alice.signer).delegate(ZERO_ADDRESS)
      ).to.be.revertedWith(
        "Cannot cancel delegation without existing delegation"
      );
    });

    it("reverts when no boost to delegate", async () => {
      // Only applies when delegating to same person again
      // otherwise it is considered a transfer of delegation
      await votingLockup.connect(alice.signer).delegate(bob.address);
      await expect(
        votingLockup.connect(alice.signer).delegate(bob.address)
      ).to.be.revertedWith("No boost available");
    });

    it("reverts on negative boost", async () => {
      await votingLockup
        .connect(david.signer)
        .createLock(stakeAmt1, expireTime);

      await votingLockup.connect(david.signer).delegate(alice.address);

      await increaseTimeTo((await getTimestamp()).add(ONE_WEEK).add(1));

      await expect(
        votingLockup.connect(david.signer).delegate(charlie.address)
      ).to.be.revertedWith(
        "Delegated a now expired boost in the past. Please cancel"
      );
    });

    it("reverts on delegation to oneself", async () => {
      await expect(
        votingLockup.connect(alice.signer).delegate(alice.address)
      ).to.be.revertedWith("Cannot delegate to oneself");
    });

    it.skip("reverts on invalid slope", async () => {
      // slope can be equal to 0 due to integer division, as the
      // amount of boost we are delegating is divided by the length of the
      // boost period, in which case if abs(y) < boost period, the slope will be 0

      //let amt = BN.from(Math.floor(parseInt(ONE_YEAR.mul(3).div(ONE_WEEK).toString()))).mul(ONE_WEEK);
      //let expireTime = BN.from(Math.floor(parseInt((await getTimestamp()).add(amt).div(ONE_WEEK).toString()))).mul(ONE_WEEK);
      let amt = ONE_YEAR.mul(3);
      let expireTime = (await getTimestamp()).add(amt);

      await votingLockup
        .connect(david.signer)
        .createLock(amt, expireTime.add(ONE_WEEK));

      await expect(
        votingLockup.connect(david.signer).delegate(alice.address)
      ).to.be.revertedWith("invalid slope");
    });

    it("creates delegation for another address", async () => {
      await votingLockup.connect(alice.signer).delegate(charlie.address);

      const b = (await ethers.provider.getBlock("latest")).number;

      let alice_adj_balance = await votingLockup.getPriorVotes(
        alice.address,
        b
      );
      let charlie_adj_balance = await votingLockup.getPriorVotes(
        charlie.address,
        b
      );

      let [alice_delgated_boost, ,] = await votingLockup.checkBoost(
        alice.address,
        true
      );
      let [charlie_received_boost, ,] = await votingLockup.checkBoost(
        charlie.address,
        false
      );

      let alice_vecrv_balance = await votingLockup.balanceOfAt(
        alice.address,
        BN.from((await latestBlock()).number)
      );

      expect(alice_adj_balance).eq(0);
      expect(charlie_adj_balance).eq(alice_vecrv_balance);
      expect(charlie_received_boost).eq(alice_delgated_boost);
    });

    it("creates delegation for another address, cancels, 2 times over, then delegates", async () => {
      await votingLockup.connect(alice.signer).delegate(charlie.address);
      await votingLockup.connect(alice.signer).delegate(ZERO_ADDRESS);
      await votingLockup.connect(alice.signer).delegate(charlie.address);
      await votingLockup.connect(alice.signer).delegate(ZERO_ADDRESS);
      await votingLockup.connect(alice.signer).delegate(charlie.address);

      const b = (await ethers.provider.getBlock("latest")).number;

      let alice_adj_balance = await votingLockup.getPriorVotes(
        alice.address,
        b
      );
      let charlie_adj_balance = await votingLockup.getPriorVotes(
        charlie.address,
        b
      );

      let [alice_delgated_boost, ,] = await votingLockup.checkBoost(
        alice.address,
        true
      );
      let [charlie_received_boost, ,] = await votingLockup.checkBoost(
        charlie.address,
        false
      );

      let alice_vecrv_balance = await votingLockup.balanceOfAt(
        alice.address,
        b
      );

      expect(alice_adj_balance).eq(0);
      expect(charlie_adj_balance).eq(alice_vecrv_balance);
      expect(charlie_received_boost).eq(alice_delgated_boost);
    });

    it("transfers delegation to another address", async () => {
      await votingLockup.connect(alice.signer).delegate(charlie.address);

      await votingLockup.connect(alice.signer).delegate(david.address);

      const b = (await ethers.provider.getBlock("latest")).number;

      let alice_adj_balance = await votingLockup.getPriorVotes(
        alice.address,
        b
      );

      let david_adj_balance = await votingLockup.getPriorVotes(
        david.address,
        b
      );

      let charlie_adj_balance = await votingLockup.getPriorVotes(
        charlie.address,
        b
      );

      let [alice_delgated_boost, ,] = await votingLockup.checkBoost(
        alice.address,
        true
      );
      let [david_received_boost, ,] = await votingLockup.checkBoost(
        david.address,
        false
      );

      let [charlie_received_boost, ,] = await votingLockup.checkBoost(
        charlie.address,
        false
      );

      let alice_vecrv_balance = await votingLockup.balanceOfAt(
        alice.address,
        b
      );

      expect(alice_adj_balance).eq(0);

      expect(david_adj_balance).eq(alice_vecrv_balance);
      expect(david_received_boost).eq(alice_delgated_boost);

      expect(charlie_adj_balance).eq(0);
      expect(charlie_received_boost).eq(0);
    });

    it("transfers delegation to another address, then to another, 2 times over, then delegates", async () => {
      await votingLockup.connect(alice.signer).delegate(charlie.address);
      await votingLockup.connect(alice.signer).delegate(david.address);
      await votingLockup.connect(alice.signer).delegate(charlie.address);
      await votingLockup.connect(alice.signer).delegate(david.address);
      await votingLockup.connect(alice.signer).delegate(charlie.address);

      const b = (await ethers.provider.getBlock("latest")).number;

      let alice_adj_balance = await votingLockup.getPriorVotes(
        alice.address,
        b
      );

      let david_adj_balance = await votingLockup.getPriorVotes(
        david.address,
        b
      );

      let charlie_adj_balance = await votingLockup.getPriorVotes(
        charlie.address,
        b
      );

      let [alice_delgated_boost, ,] = await votingLockup.checkBoost(
        alice.address,
        true
      );
      let [david_received_boost, ,] = await votingLockup.checkBoost(
        david.address,
        false
      );

      let [charlie_received_boost, ,] = await votingLockup.checkBoost(
        charlie.address,
        false
      );

      let alice_vecrv_balance = await votingLockup.balanceOfAt(
        alice.address,
        b
      );

      expect(alice_adj_balance).eq(0);

      expect(charlie_adj_balance).eq(alice_vecrv_balance);
      expect(charlie_received_boost).eq(alice_delgated_boost);

      expect(david_adj_balance).eq(0);
      expect(david_received_boost).eq(0);
    });

    it("cancels delegation before expiry", async () => {
      await votingLockup
        .connect(david.signer)
        .createLock(stakeAmt1, expireTime);

      await votingLockup.connect(david.signer).delegate(charlie.address);
      await increaseTimeTo((await getTimestamp()).add(ONE_WEEK).sub(100));
      await votingLockup.connect(david.signer).delegate(ZERO_ADDRESS);

      const b = (await ethers.provider.getBlock("latest")).number;

      let david_adj_balance = await votingLockup.getPriorVotes(
        david.address,
        b
      );
      let charlie_adj_balance = await votingLockup.getPriorVotes(
        charlie.address,
        b
      );

      let [david_delgated_boost, ,] = await votingLockup.checkBoost(
        david.address,
        true
      );
      let [charlie_received_boost, ,] = await votingLockup.checkBoost(
        charlie.address,
        false
      );

      let david_vecrv_balance = await votingLockup.balanceOfAt(
        david.address,
        b
      );

      expect(david_adj_balance).eq(david_vecrv_balance);
      expect(charlie_adj_balance).eq(0);
      expect(david_delgated_boost).eq(0);
      expect(charlie_received_boost).eq(0);
    });

    it("cancels delegation after expiry", async () => {
      await votingLockup
        .connect(david.signer)
        .createLock(stakeAmt1, expireTime);

      await votingLockup.connect(david.signer).delegate(charlie.address);
      await increaseTime(ONE_WEEK.add(100));

      await votingLockup.connect(david.signer).delegate(ZERO_ADDRESS);

      const b = (await ethers.provider.getBlock("latest")).number;

      let david_adj_balance = await votingLockup.getPriorVotes(
        david.address,
        b
      );
      let charlie_adj_balance = await votingLockup.getPriorVotes(
        charlie.address,
        b
      );

      let [david_delgated_boost, ,] = await votingLockup.checkBoost(
        david.address,
        true
      );
      let [charlie_received_boost, ,] = await votingLockup.checkBoost(
        charlie.address,
        false
      );

      let david_vecrv_balance = await votingLockup.balanceOfAt(
        david.address,
        b
      );

      expect(david_adj_balance).eq(david_vecrv_balance);
      expect(charlie_adj_balance).eq(0);
      expect(david_delgated_boost).eq(0);
      expect(charlie_received_boost).eq(0);
    });

    it("increases lock length which allows for further out expiry and longer delegation", async () => {
      await votingLockup
        .connect(david.signer)
        .createLock(stakeAmt1, start.add(ONE_YEAR));

      await votingLockup.connect(david.signer).delegate(alice.address);

      await votingLockup
        .connect(david.signer)
        .increaseLockLength(start.add(ONE_YEAR.mul(2)));

      await increaseTimeTo(start.add(ONE_YEAR).add(100));

      await votingLockup.connect(david.signer).delegate(ZERO_ADDRESS);

      await votingLockup.connect(david.signer).delegate(alice.address);

      const b = (await ethers.provider.getBlock("latest")).number;

      let david_adj_balance = await votingLockup.getPriorVotes(
        david.address,
        b
      );

      let alice_adj_balance2 = await votingLockup.getPriorVotes(
        alice.address,
        b
      );

      let david_vecrv_balance = await votingLockup.balanceOfAt(
        david.address,
        b
      );

      expect(david_adj_balance).eq(0);
      expect(alice_adj_balance2).eq(david_vecrv_balance);
    });

    it("transfers delegation after increasing lock amount", async () => {
      await votingLockup.connect(alice.signer).delegate(charlie.address);

      const b = (await ethers.provider.getBlock("latest")).number;

      let charlie_adj_balance = await votingLockup.getPriorVotes(
        charlie.address,
        b
      );

      let alice_vecrv_balance = await votingLockup.balanceOfAt(
        alice.address,
        b
      );

      await votingLockup.connect(alice.signer).increaseLockAmount(stakeAmt1);

      await votingLockup.connect(alice.signer).delegate(david.address);

      const b2 = (await ethers.provider.getBlock("latest")).number;

      let charlie_adj_balance2 = await votingLockup.getPriorVotes(
        charlie.address,
        b2
      );

      let david_adj_balance = await votingLockup.getPriorVotes(
        david.address,
        b2
      );

      let alice_vecrv_balance2 = await votingLockup.balanceOfAt(
        alice.address,
        b2
      );

      expect(charlie_adj_balance).eq(alice_vecrv_balance);
      expect(charlie_adj_balance2).eq(0);
      expect(david_adj_balance).eq(alice_vecrv_balance2);
      expect(david_adj_balance).gt(charlie_adj_balance);
    });
  });

  // Integration test ported from
  // https://github.com/curvefi/curve-dao-contracts/blob/master/tests/integration/VotingEscrow/test_votingLockup.py
  // Added reward claiming & static balance analysis
  describe("testing voting powers changing", () => {
    before(async () => {
      await deployFresh();
    });

    /**
     *
     * Test voting power in the following scenario.
     * Alice:
     * ~~~~~~~
     * ^
     * | *       *
     * | | \     |  \
     * | |  \    |    \
     * +-+---+---+------+---> t
     *
     * Bob:
     * ~~~~~~~
     * ^
     * |         *
     * |         | \
     * |         |  \
     * +-+---+---+---+--+---> t
     *
     * Alice has 100% of voting power in the first period.
     * She has 2/3 power at the start of 2nd period, with Bob having 1/2 power
     * (due to smaller locktime).
     * Alice's power grows to 100% by Bob's unlock.
     *
     * Checking that totalSupply is appropriate.
     *
     * After the test is done, check all over again with balanceOfAt / totalSupplyAt
     *
     * Rewards for Week 1 = 1000 (Alice = 100%)
     * Rewards for Week 2 = 1000 (Alice = 66%, Bob = 33%)
     * Rewards = [1666.666, 333.333]
     */

    it("calculates voting weights on a rolling basis", async () => {
      /**
       * SETUP
       */
      const MAXTIME = await votingLockup.MAXTIME();
      const tolerance = "0.04"; // 0.04% | 0.00004 | 4e14
      const alice = sa.dummy1;
      const bob = sa.dummy2;
      const amount = simpleToExactAmount(1000, DEFAULT_DECIMALS);
      await mta
        .connect(sa.fundManager.signer)
        .transfer(alice.address, amount.mul(5));
      await mta
        .connect(sa.fundManager.signer)
        .transfer(bob.address, amount.mul(5));
      var stages: any = {};

      await mta
        .connect(alice.signer)
        .approve(votingLockup.address, amount.mul(5));
      await mta
        .connect(bob.signer)
        .approve(votingLockup.address, amount.mul(5));

      expect(await votingLockup.totalSupply()).eq(BN.from(0));
      expect(await votingLockup.balanceOf(alice.address)).eq(BN.from(0));
      expect(await votingLockup.balanceOf(bob.address)).eq(BN.from(0));

      /**
       * BEGIN PERIOD 1
       * Move to timing which is good for testing - beginning of a UTC week
       * Fund the pool
       */

      await goToNextUnixWeekStart();
      await increaseTime(ONE_HOUR);

      stages["before_deposits"] = [
        BN.from((await latestBlock()).number),
        await getTimestamp(),
      ];

      await votingLockup
        .connect(alice.signer)
        .createLock(amount, (await getTimestamp()).add(ONE_WEEK.add(1)));
      stages["alice_deposit"] = [
        BN.from((await latestBlock()).number),
        await getTimestamp(),
      ];

      await increaseTime(ONE_HOUR);
      await advanceBlock();
      assertBNClosePercent(
        await votingLockup.balanceOf(alice.address),
        amount.div(MAXTIME).mul(ONE_WEEK.sub(ONE_HOUR.mul(2))),
        tolerance
      );
      assertBNClosePercent(
        await votingLockup.totalSupply(),
        amount.div(MAXTIME).mul(ONE_WEEK.sub(ONE_HOUR.mul(2))),
        tolerance
      );
      expect(await votingLockup.balanceOf(bob.address)).eq(BN.from(0));
      let t0 = await getTimestamp();
      let dt = BN.from(0);

      stages["alice_in_0"] = [];
      stages["alice_in_0"].push([
        BN.from((await latestBlock()).number),
        await getTimestamp(),
      ]);

      /**
       * Measure Alice's decay over whole week
       */
      for (let i = 0; i < 7; i += 1) {
        for (let j = 0; j < 24; j += 1) {
          await increaseTime(ONE_HOUR);
          await advanceBlock();
        }
        dt = (await getTimestamp()).sub(t0);
        assertBNClosePercent(
          await votingLockup.totalSupply(),
          amount
            .div(MAXTIME)
            .mul(maximum(ONE_WEEK.sub(ONE_HOUR.mul(2)).sub(dt), BN.from(0))),
          tolerance
        );
        assertBNClosePercent(
          await votingLockup.balanceOf(alice.address),
          amount
            .div(MAXTIME)
            .mul(maximum(ONE_WEEK.sub(ONE_HOUR.mul(2)).sub(dt), BN.from(0))),
          tolerance
        );
        expect(await votingLockup.balanceOf(bob.address)).eq(BN.from(0));
        stages["alice_in_0"].push([
          BN.from((await latestBlock()).number),
          await getTimestamp(),
        ]);
      }

      await increaseTime(ONE_HOUR);

      expect(await votingLockup.balanceOf(alice.address)).eq(BN.from(0));
      await votingLockup.connect(alice.signer).withdraw();

      stages["alice_withdraw"] = [
        BN.from((await latestBlock()).number),
        await getTimestamp(),
      ];
      expect(await votingLockup.totalSupply()).eq(BN.from(0));
      expect(await votingLockup.balanceOf(alice.address)).eq(BN.from(0));
      expect(await votingLockup.balanceOf(bob.address)).eq(BN.from(0));

      await increaseTime(ONE_HOUR);
      await advanceBlock();

      /**
       * BEGIN PERIOD 2
       * Next week (for round counting)
       */
      await goToNextUnixWeekStart();

      await votingLockup
        .connect(alice.signer)
        .createLock(amount, (await getTimestamp()).add(ONE_WEEK.mul(2)));
      stages["alice_deposit_2"] = [
        BN.from((await latestBlock()).number),
        await getTimestamp(),
      ];

      assertBNClosePercent(
        await votingLockup.totalSupply(),
        amount.div(MAXTIME).mul(2).mul(ONE_WEEK),
        tolerance
      );
      assertBNClosePercent(
        await votingLockup.balanceOf(alice.address),
        amount.div(MAXTIME).mul(2).mul(ONE_WEEK),
        tolerance
      );
      expect(await votingLockup.balanceOf(bob.address)).eq(BN.from(0));

      await votingLockup
        .connect(bob.signer)
        .createLock(amount, (await getTimestamp()).add(ONE_WEEK.add(1)));
      stages["bob_deposit_2"] = [
        BN.from((await latestBlock()).number),
        await getTimestamp(),
      ];

      assertBNClosePercent(
        await votingLockup.totalSupply(),
        amount.div(MAXTIME).mul(3).mul(ONE_WEEK),
        tolerance
      );
      assertBNClosePercent(
        await votingLockup.balanceOf(alice.address),
        amount.div(MAXTIME).mul(2).mul(ONE_WEEK),
        tolerance
      );
      assertBNClosePercent(
        await votingLockup.balanceOf(bob.address),
        amount.div(MAXTIME).mul(ONE_WEEK),
        tolerance
      );

      t0 = await getTimestamp();
      await increaseTime(ONE_HOUR);
      await advanceBlock();

      let w_alice = BN.from(0);
      let w_total = BN.from(0);
      let w_bob = BN.from(0);

      stages["alice_bob_in_2"] = [];
      // Beginning of week: weight 3
      // End of week: weight 1
      for (let i = 0; i < 7; i += 1) {
        for (let j = 0; j < 24; j += 1) {
          await increaseTime(ONE_HOUR);
          await advanceBlock();
        }
        dt = (await getTimestamp()).sub(t0);
        const b = BN.from((await latestBlock()).number);
        w_total = await votingLockup.totalSupplyAt(b);
        w_alice = await votingLockup.getPriorVotes(alice.address, b);
        w_bob = await votingLockup.getPriorVotes(bob.address, b);
        expect(w_total).eq(w_alice.add(w_bob));
        assertBNClosePercent(
          w_alice,
          amount.div(MAXTIME).mul(maximum(ONE_WEEK.mul(2).sub(dt), BN.from(0))),
          tolerance
        );
        assertBNClosePercent(
          w_bob,
          amount.div(MAXTIME).mul(maximum(ONE_WEEK.sub(dt), BN.from(0))),
          tolerance
        );
        stages["alice_bob_in_2"].push([
          BN.from((await latestBlock()).number),
          await getTimestamp(),
        ]);
      }

      await increaseTime(ONE_HOUR);
      await advanceBlock();

      await votingLockup.connect(bob.signer).withdraw();
      t0 = await getTimestamp();
      stages["bob_withdraw_1"] = [
        BN.from((await latestBlock()).number),
        await getTimestamp(),
      ];
      w_total = await votingLockup.totalSupply();
      w_alice = await votingLockup.balanceOf(alice.address);
      expect(w_alice).eq(w_total);

      assertBNClosePercent(
        w_total,
        amount.div(MAXTIME).mul(ONE_WEEK.sub(ONE_HOUR.mul(2))),
        tolerance
      );
      expect(await votingLockup.balanceOf(bob.address)).eq(BN.from(0));

      await increaseTime(ONE_HOUR);
      await advanceBlock();

      stages["alice_in_2"] = [];
      for (let i = 0; i < 7; i += 1) {
        for (let j = 0; j < 24; j += 1) {
          await increaseTime(ONE_HOUR);
          await advanceBlock();
        }
        dt = (await getTimestamp()).sub(t0);
        w_total = await votingLockup.totalSupply();
        w_alice = await votingLockup.balanceOf(alice.address);
        expect(w_total).eq(w_alice);
        assertBNClosePercent(
          w_total,
          amount
            .div(MAXTIME)
            .mul(
              maximum(
                ONE_WEEK.sub(dt).sub(ONE_HOUR.mul(37).div(DEFAULT_DECIMALS)),
                BN.from(0)
              )
            ),
          "0.04"
        );
        expect(await votingLockup.balanceOf(bob.address)).eq(BN.from(0));
        stages["alice_in_2"].push([
          BN.from((await latestBlock()).number),
          await getTimestamp(),
        ]);
      }

      await votingLockup.connect(alice.signer).withdraw();
      stages["alice_withdraw_2"] = [
        BN.from((await latestBlock()).number),
        await getTimestamp(),
      ];

      await increaseTime(ONE_HOUR);
      await advanceBlock();

      // votingLockup.connect(bob.signer).withdraw();
      stages["bob_withdraw_2"] = [
        BN.from((await latestBlock()).number),
        await getTimestamp(),
      ];

      expect(await votingLockup.totalSupply()).eq(BN.from(0));
      expect(await votingLockup.balanceOf(alice.address)).eq(BN.from(0));
      expect(await votingLockup.balanceOf(bob.address)).eq(BN.from(0));

      /**
       * END OF INTERACTION
       * BEGIN HISTORICAL ANALYSIS USING BALANCEOFAT
       */
      expect(
        await votingLockup.getPriorVotes(
          alice.address,
          stages["before_deposits"][0]
        )
      ).eq(BN.from(0));
      expect(
        await votingLockup.getPriorVotes(
          bob.address,
          stages["before_deposits"][0]
        )
      ).eq(BN.from(0));
      expect(await votingLockup.totalSupplyAt(stages["before_deposits"][0])).eq(
        BN.from(0)
      );

      w_alice = await votingLockup.getPriorVotes(
        alice.address,
        stages["alice_deposit"][0]
      );
      assertBNClosePercent(
        w_alice,
        amount.div(MAXTIME).mul(ONE_WEEK.sub(ONE_HOUR)),
        tolerance
      );
      expect(
        await votingLockup.getPriorVotes(
          bob.address,
          stages["alice_deposit"][0]
        )
      ).eq(BN.from(0));
      w_total = await votingLockup.totalSupplyAt(stages["alice_deposit"][0]);
      expect(w_alice).eq(w_total);

      for (let i = 0; i < stages["alice_in_0"].length; i += 1) {
        const [block] = stages["alice_in_0"][i];
        w_alice = await votingLockup.getPriorVotes(alice.address, block);
        w_bob = await votingLockup.getPriorVotes(bob.address, block);
        w_total = await votingLockup.totalSupplyAt(block);
        expect(w_bob).eq(BN.from(0));
        expect(w_alice).eq(w_total);
        const time_left = ONE_WEEK.mul(7 - i)
          .div(7)
          .sub(ONE_HOUR.mul(2));
        const error_1h = (ONE_HOUR.toNumber() * 100) / time_left.toNumber(); // Rounding error of 1 block is possible, and we have 1h blocks
        assertBNClosePercent(
          w_alice,
          amount.div(MAXTIME).mul(time_left),
          error_1h.toString()
        );
      }

      w_total = await votingLockup.totalSupplyAt(stages["alice_withdraw"][0]);
      w_alice = await votingLockup.getPriorVotes(
        alice.address,
        stages["alice_withdraw"][0]
      );
      w_bob = await votingLockup.getPriorVotes(
        bob.address,
        stages["alice_withdraw"][0]
      );
      expect(w_total).eq(BN.from(0));
      expect(w_alice).eq(BN.from(0));
      expect(w_bob).eq(BN.from(0));

      w_total = await votingLockup.totalSupplyAt(stages["alice_deposit_2"][0]);
      w_alice = await votingLockup.getPriorVotes(
        alice.address,
        stages["alice_deposit_2"][0]
      );
      w_bob = await votingLockup.getPriorVotes(
        bob.address,
        stages["alice_deposit_2"][0]
      );
      assertBNClosePercent(
        w_total,
        amount.div(MAXTIME).mul(2).mul(ONE_WEEK),
        tolerance
      );
      expect(w_total).eq(w_alice);
      expect(w_bob).eq(BN.from(0));

      w_total = await votingLockup.totalSupplyAt(stages["bob_deposit_2"][0]);
      w_alice = await votingLockup.getPriorVotes(
        alice.address,
        stages["bob_deposit_2"][0]
      );
      w_bob = await votingLockup.getPriorVotes(
        bob.address,
        stages["bob_deposit_2"][0]
      );
      expect(w_total).eq(w_alice.add(w_bob));
      assertBNClosePercent(
        w_total,
        amount.div(MAXTIME).mul(3).mul(ONE_WEEK),
        tolerance
      );
      assertBNClosePercent(
        w_alice,
        amount.div(MAXTIME).mul(2).mul(ONE_WEEK),
        tolerance
      );

      let error_1h = 0;
      [, t0] = stages["bob_deposit_2"];
      for (let i = 0; i < stages["alice_bob_in_2"].length; i += 1) {
        const [block, ts] = stages["alice_bob_in_2"][i];
        w_alice = await votingLockup.getPriorVotes(alice.address, block);
        w_bob = await votingLockup.getPriorVotes(bob.address, block);
        w_total = await votingLockup.totalSupplyAt(block);
        expect(w_total).eq(w_alice.add(w_bob));
        dt = ts.sub(t0);
        error_1h =
          (ONE_HOUR.toNumber() * 100) /
          (ONE_WEEK.mul(2).toNumber() - i - ONE_DAY.toNumber());
        assertBNClosePercent(
          w_alice,
          amount.div(MAXTIME).mul(maximum(ONE_WEEK.mul(2).sub(dt), BN.from(0))),
          error_1h.toString()
        );
        assertBNClosePercent(
          w_bob,
          amount.div(MAXTIME).mul(maximum(ONE_WEEK.sub(dt), BN.from(0))),
          error_1h.toString()
        );
      }
      w_total = await votingLockup.totalSupplyAt(stages["bob_withdraw_1"][0]);
      w_alice = await votingLockup.getPriorVotes(
        alice.address,
        stages["bob_withdraw_1"][0]
      );
      w_bob = await votingLockup.getPriorVotes(
        bob.address,
        stages["bob_withdraw_1"][0]
      );
      expect(w_total).eq(w_alice);
      assertBNClosePercent(
        w_total,
        amount.div(MAXTIME).mul(ONE_WEEK.sub(ONE_HOUR.mul(2))),
        tolerance
      );
      expect(w_bob).eq(BN.from(0));
      [, t0] = stages["bob_withdraw_1"];
      for (let i = 0; i < stages["alice_in_2"].length; i += 1) {
        const [block, ts] = stages["alice_in_2"][i];
        w_alice = await votingLockup.getPriorVotes(alice.address, block);
        w_bob = await votingLockup.getPriorVotes(bob.address, block);
        w_total = await votingLockup.totalSupplyAt(block);
        expect(w_total).eq(w_alice);
        expect(w_bob).eq(BN.from(0));
        dt = ts.sub(t0);
        error_1h =
          (ONE_HOUR.toNumber() * 100) /
          (ONE_WEEK.toNumber() - i * ONE_DAY.toNumber() + ONE_DAY.toNumber());
        assertBNClosePercent(
          w_total,
          amount
            .div(MAXTIME)
            .mul(maximum(ONE_WEEK.sub(dt).sub(ONE_HOUR.mul(2)), BN.from(0))),
          error_1h.toString()
        );
      }
      w_total = await votingLockup.totalSupplyAt(stages["bob_withdraw_2"][0]);
      w_alice = await votingLockup.getPriorVotes(
        alice.address,
        stages["bob_withdraw_2"][0]
      );
      w_bob = await votingLockup.getPriorVotes(
        bob.address,
        stages["bob_withdraw_2"][0]
      );
      expect(w_total).eq(BN.from(0));
      expect(w_alice).eq(BN.from(0));
      expect(w_bob).eq(BN.from(0));
    });
  });

  describe('gas test', () => {
    let alice: Account;
    let bob: Account;
    let start: BN;
    let maxTime: BN;
    let stakeAmt1: BN;

    before(async() => {
      alice = sa.default;
      bob = sa.dummy1;
      stakeAmt1 = simpleToExactAmount(10, DEFAULT_DECIMALS);

      await goToNextUnixWeekStart();
      start = await getTimestamp();
      await deployFresh();
      maxTime = await votingLockup.MAXTIME();
      await mta
        .connect(sa.fundManager.signer)
        .transfer(alice.address, simpleToExactAmount(1, 22));
    });

    it('fits gas budget for createLock', async() => {
      const tx = await votingLockup
          .connect(alice.signer)
          .createLock(stakeAmt1, start.add(ONE_YEAR));
      const receipt = await tx.wait()
      console.log(receipt.gasUsed.toNumber())
      expect(receipt.gasUsed.toNumber()).lt(350000);
    });

    it('fits gas budget for delegate', async () => {
      const tx = await votingLockup.connect(alice.signer).delegate(bob.address);
      const receipt = await tx.wait()
      expect(receipt.gasUsed.toNumber()).lt(230000);
    })
  })
});
