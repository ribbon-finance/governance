"use strict";

const { ethers } = require("hardhat");
const { expect } = require("chai");

let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("Owned contract", function () {
  let Owned;
  let deployerAccount;
  let account1;
  let account2;
  let account3;
  let account4;

  beforeEach(async function () {
    Owned = await ethers.getContractFactory("Owned");
    [
      deployerAccount,
      account1,
      account2,
      ...account4
    ] = await ethers.getSigners();
  });

  it("should revert when owner parameter is passed the zero address", async () => {
    await expect(Owned.deploy(ZERO_ADDRESS)).to.be.revertedWith(
      "Owner address cannot be 0"
    );
  });

  it("should set owner address on deployment", async () => {
    const ownedContractInstance = await Owned.deploy(account1.address);
    const owner = await ownedContractInstance.owner();
    await expect(owner).to.equal(account1.address);
  });

  describe("given an instance", () => {
    let ownedContractInstance;

    beforeEach(async () => {
      ownedContractInstance = await Owned.deploy(account1.address);
      await ownedContractInstance.deployed();
    });

    it("should not nominate new owner when not invoked by current contract owner", async () => {
      const nominatedOwner = account2.address;

      await expect(
        ownedContractInstance.connect(account2).nominateNewOwner(nominatedOwner)
      ).to.be.revertedWith("Only the contract owner may perform this action");

      const nominatedOwnerFrmContract = await ownedContractInstance.nominatedOwner();
      await expect(nominatedOwnerFrmContract).to.equal(ZERO_ADDRESS);
    });

    it("should nominate new owner when invoked by current contract owner", async () => {
      const nominatedOwner = account2.address;

      const txn = await ownedContractInstance
        .connect(account1)
        .nominateNewOwner(nominatedOwner);

      await expect(txn).to.emit(ownedContractInstance, "OwnerNominated");

      const nominatedOwnerFromContract = await ownedContractInstance.nominatedOwner();
      await expect(nominatedOwnerFromContract).to.equal(nominatedOwner);
    });

    it("should not accept new owner nomination when not invoked by nominated owner", async () => {
      const nominatedOwner = account2.address;

      await expect(
        ownedContractInstance.connect(account2).acceptOwnership()
      ).to.be.revertedWith(
        "You must be nominated before you can accept ownership"
      );

      const owner = await ownedContractInstance.owner();
      await expect(owner).to.not.equal(nominatedOwner);
    });

    it("should accept new owner nomination when invoked by nominated owner", async () => {
      const nominatedOwner = account2.address;
      let txn = await ownedContractInstance
        .connect(account1)
        .nominateNewOwner(nominatedOwner);
      await expect(txn).to.emit(ownedContractInstance, "OwnerNominated");

      const nominatedOwnerFromContract = await ownedContractInstance.nominatedOwner();
      await expect(nominatedOwnerFromContract).to.equal(nominatedOwner);

      txn = await ownedContractInstance.connect(account2).acceptOwnership();

      await expect(txn).to.emit(ownedContractInstance, "OwnerChanged");

      const owner = await ownedContractInstance.owner();
      const nominatedOwnerFromContact = await ownedContractInstance.nominatedOwner();

      await expect(owner).to.equal(nominatedOwner);
      await expect(nominatedOwnerFromContact).to.equal(ZERO_ADDRESS);
    });
  });
});
