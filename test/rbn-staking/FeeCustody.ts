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

// WBTC Address
// WETH Address
// AAVE Address
// USDC Address
// ETH Address

// Constructor
  // sets pctAllocationForRBNLockers
  // sets distributionToken
  // sets feeDistributor
  // sets protocolRevenueRecipient
  // transfers ownership

// onlyOwner:
  // distributeProtocolRevenue
  // setAsset
  // recoverAllAssets
  // recoverAsset
  // setFeeDistributor
  // setDistributionToken
  // setProtocolRevenueRecipient

// claimableByRBNLockersOfAsset
// totalClaimableByRBNLockersInUSD
  // gets correct amount claimable

// claimableByProtocolOfAsset
// totalClaimableByProtocolInUSD
  // gets correct amount claimable

// setAsset
  // sets correct asset
    // correct oracle
    // correct intermediary path
    // emits NewAsset
  // require(IChainlink(oracles[_asset]).decimals() == 8, "!ASSET/USD");
  // require(_pathLen < 2, "invalid intermediary path");
  // require(_swapFeeLen > 0 && _swapFeeLen < 2, "invalid pool fees array length");
  // double set should not work to increase lastAssetIdx

// recoverAllAssets
  // removes everything to admin address

// recoverAsset
  // removes single asset to admin address

// setFeeDistributor
  // sets new fee distributor

// setRBNLockerAllocPCT
  // sets new rbn locker alloc pct

// setDistributionToken
  // sets new distribution token

// setProtocolRevenueRecipient
  // sets new protocol revenue recipient

// distributeProtocolRevenue
  // distributes protocol revenue

describe("Fee Custody", () => {
  let RibbonToken: ContractFactory;
  let VotingEscrow: ContractFactory;
  let FeeDistributor: ContractFactory;

  let mta: Contract,
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
