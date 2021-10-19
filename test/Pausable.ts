"use strict";

import { ethers } from "hardhat";
import { expect } from "chai";
import { assert, addSnapshotBeforeRestoreAfterEach } from "./common";
import { timeIsClose } from "./helpers";
import { currentTime, fastForward } from "./utils";
import { Contract, ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Transaction } from "@ethersproject/transactions";

describe("Pausable contract", function () {
  let TestablePausable: ContractFactory;
  let deployerAccount: SignerWithAddress;
  let account1: SignerWithAddress;
  let account2: SignerWithAddress;
  let instance: Contract;

  beforeEach(async function () {
    TestablePausable = await ethers.getContractFactory("TestablePausable");
    [deployerAccount, account1, account2] = await ethers.getSigners();
  });

  // we must snapshot here so that invoking fastForward() later on in this test does not
  // pollute the global scope by moving on the block timestamp from its starting point
  addSnapshotBeforeRestoreAfterEach();

  describe("when extended into a contract", () => {
    beforeEach(async () => {
      // the owner is the associated contract, so we can simulate
      instance = await TestablePausable.deploy(account1.address);

      await instance.deployed();
    });

    it("is not paused by default", async () => {
      assert.equal(await instance.paused(), false);
      assert.equal(await instance.lastPauseTime(), "0");
    });
    describe("setPaused()", () => {
      it("can only be invoked by the owner", async () => {
        await expect(instance.connect(account1).setPaused(true)).to.emit(
          instance,
          "PauseChanged"
        );
        assert.revert(
          instance.connect(deployerAccount).setPaused(true),
          "Only the contract owner may perform this action"
        );
      });
      describe("when invoked by the owner to true", () => {
        let txn: Transaction;
        let timestamp: number;

        beforeEach(async () => {
          timestamp = await currentTime();
          txn = await instance.connect(account1).setPaused(true);
        });
        it("is it then paused", async () => {
          assert.equal(await instance.paused(), true);
        });
        it("with the current timestamp as the lastPauseTime", async () => {
          timeIsClose({
            actual: await instance.lastPauseTime(),
            expected: timestamp,
          });
        });
        it("and the PauseChange event is emitted", async () => {
          await expect(txn).to.emit(instance, "PauseChanged");
        });
        it("and calling setPaused when already paused remains paused with no change to pause time", async () => {
          await instance.connect(account1).setPaused(true);
          assert.equal(await instance.paused(), true);
          timeIsClose({
            actual: await instance.lastPauseTime(),
            expected: timestamp,
          });
        });
        describe("when invoked by the owner to false", () => {
          let txn: Transaction;
          beforeEach(async () => {
            await fastForward(100);
            txn = await instance.connect(account1).setPaused(false);
          });

          it("is it then unpaused", async () => {
            assert.equal(await instance.paused(), false);
          });

          it("and the lastPauseTime is still unchanged", async () => {
            timeIsClose({
              actual: await instance.lastPauseTime(),
              expected: timestamp,
            });
          });

          it("and the PauseChange event is emitted", async () => {
            await expect(txn).to.emit(instance, "PauseChanged");
          });
        });
      });
    });
    describe("notPaused modifier", () => {
      beforeEach(async () => {
        instance = await TestablePausable.deploy(account1.address);
      });
      it("initial condition is met", async () => {
        assert.equal(await instance.someValue(), "0");
      });
      describe("when setSomeValue() is invoked", () => {
        beforeEach(async () => {
          await instance.setSomeValue("3");
        });
        it("succeeds as not paused", async () => {
          assert.equal(await instance.someValue(), "3");
        });
        describe("when paused", () => {
          beforeEach(async () => {
            await instance.connect(account1).setPaused(true);
          });
          describe("when setSomeValue() is invoked", () => {
            it("fails as the function is paused", async () => {
              await assert.revert(instance.setSomeValue("5"));
            });
          });
        });
      });
    });
  });
});
