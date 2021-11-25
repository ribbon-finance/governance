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

describe("SmartWalletWhitelist", () => {
  let SmartWalletWhitelist: ContractFactory;
  let TestChecker: ContractFactory;

  let smartWalletWhitelist: Contract, checker: Contract;

  before("Init contract", async () => {
    const accounts = await ethers.getSigners();
    sa = await new StandardAccounts().initAccounts(accounts);

    // Get RBN token
    TestChecker = await ethers.getContractFactory("TestChecker");
    checker = await TestChecker.deploy();

    await checker.deployed();

    // Get redeemer contract
    SmartWalletWhitelist = await ethers.getContractFactory(
      "SmartWalletWhitelist"
    );
    smartWalletWhitelist = await SmartWalletWhitelist.deploy(
      sa.fundManager.address,
      sa.dummy1.address
    );

    await smartWalletWhitelist.deployed();
  });

  describe("checking public variables", () => {
    it("returns dao", async () => {
      expect(await smartWalletWhitelist.dao()).eq(sa.fundManager.address);
    });
    it("returns voter", async () => {
      expect(await smartWalletWhitelist.voter()).eq(sa.dummy1.address);
    });
  });

  describe("change whitelisted wallets", () => {
    it("fails when trying to set wallet as non-dao", async () => {
      await expect(
        smartWalletWhitelist
          .connect(sa.other.signer)
          .approveWallet(sa.dummy2.address)
      ).to.be.revertedWith("!dao");
    });
    it("fails when trying to revoke wallet as non-dao", async () => {
      await expect(
        smartWalletWhitelist
          .connect(sa.other.signer)
          .revokeWallet(sa.dummy2.address)
      ).to.be.revertedWith("!dao");
    });
    it("approves wallet", async () => {
      expect(await smartWalletWhitelist.check(sa.dummy2.address)).eq(false);
      smartWalletWhitelist
        .connect(sa.fundManager.signer)
        .approveWallet(sa.dummy2.address);
      expect(await smartWalletWhitelist.check(sa.dummy2.address)).eq(true);
    });
    it("revokes wallet", async () => {
      expect(await smartWalletWhitelist.check(sa.dummy2.address)).eq(false);
      smartWalletWhitelist
        .connect(sa.fundManager.signer)
        .approveWallet(sa.dummy2.address);
      expect(await smartWalletWhitelist.check(sa.dummy2.address)).eq(true);
      smartWalletWhitelist
        .connect(sa.fundManager.signer)
        .revokeWallet(sa.dummy2.address);
      expect(await smartWalletWhitelist.check(sa.dummy2.address)).eq(false);
    });
  });

  describe("sets checker", () => {
    it("fails when trying to commit checker as non-dao", async () => {
      await expect(
        smartWalletWhitelist
          .connect(sa.other.signer)
          .commitSetChecker(sa.dummy2.address)
      ).to.be.revertedWith("!dao");
    });
    it("fails when trying to apply checker as non-dao", async () => {
      await expect(
        smartWalletWhitelist.connect(sa.other.signer).applySetChecker()
      ).to.be.revertedWith("!dao");
    });
    it("commits checker", async () => {
      expect(await smartWalletWhitelist.future_checker()).eq(ZERO_ADDRESS);
      smartWalletWhitelist
        .connect(sa.fundManager.signer)
        .commitSetChecker(sa.dummy2.address);
      expect(await smartWalletWhitelist.future_checker()).eq(sa.dummy2.address);
    });
    it("applies checker", async () => {
      expect(await smartWalletWhitelist.future_checker()).eq(ZERO_ADDRESS);
      smartWalletWhitelist
        .connect(sa.fundManager.signer)
        .commitSetChecker(sa.dummy2.address);
      expect(await smartWalletWhitelist.future_checker()).eq(sa.dummy2.address);
      expect(await smartWalletWhitelist.checker()).eq(ZERO_ADDRESS);
      smartWalletWhitelist.connect(sa.fundManager.signer).applySetChecker();
      expect(await smartWalletWhitelist.checker()).eq(sa.dummy2.address);
    });
    it("changes whitelist from checker", async () => {
      smartWalletWhitelist
        .connect(sa.fundManager.signer)
        .approveWallet(sa.questMaster.address);
      expect(await smartWalletWhitelist.check(sa.questMaster.address)).eq(true);
      smartWalletWhitelist
        .connect(sa.fundManager.signer)
        .commitSetChecker(checker);
      smartWalletWhitelist.connect(sa.fundManager.signer).applySetChecker();
      expect(await smartWalletWhitelist.check(sa.questMaster.address)).eq(true);
      checker
        .connect(sa.fundManager.signer)
        .setWallet(sa.questMaster.address, true);
      smartWalletWhitelist
        .connect(sa.fundManager.signer)
        .revokeWallet(sa.questMaster.address);
      expect(await smartWalletWhitelist.check(sa.questMaster.address)).eq(true);
      checker
        .connect(sa.fundManager.signer)
        .setWallet(sa.questMaster.address, false);
      expect(await smartWalletWhitelist.check(sa.questMaster.address)).eq(
        false
      );
    });
  });
});
