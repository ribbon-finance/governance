import { Contract, ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import hre from "hardhat";
import { ensureOnlyExpectedMutativeFunctions } from "./helpers";
import { assert, addSnapshotBeforeRestoreAfterEach } from "./common";
import {
  currentTime,
  toUnit,
  fastForward,
  assertBNGreaterThan,
  assertBNLessThan,
} from "./utils";
import { expect } from "chai";

const { ethers } = hre;
const { provider, BigNumber } = ethers;

const {
  TOKEN_PARAMS,
  STAKING_REWARDS_rETHTHETA_PARAMS,
  STAKING_TOKEN_PARAMS,
  EXTERNAL_TOKEN_PARAMS,
} = require("../params");
const { formatEther } = require("@ethersproject/units");

// Tests taken from https://github.com/Synthetixio/synthetix/blob/master/test/contracts/StakingRewards.js
describe.skip("DualStakingRewards contract", function () {
  let RibbonToken: ContractFactory;
  let RibbonDualStakingRewards: ContractFactory;
  let deployerAccount: SignerWithAddress;
  let owner: SignerWithAddress;
  let mockRewardsDistributionAddress: SignerWithAddress;
  let account3: SignerWithAddress;
  let account4: SignerWithAddress;

  const DAY = 86400;

  let rewardsToken0: Contract,
    rewardsToken1: Contract,
    rewardsToken0Owner: Contract,
    rewardsToken1Owner: Contract,
    stakingToken: Contract,
    stakingTokenOwner: Contract,
    externalRewardsToken: Contract,
    externalRewardsTokenOwner: Contract,
    stakingRewards: Contract;

  addSnapshotBeforeRestoreAfterEach();

  before(async () => {
    [
      deployerAccount,
      owner,
      mockRewardsDistributionAddress,
      account3,
      account4,
    ] = await ethers.getSigners();

    // Get rewards token (RIBBON)
    RibbonToken = await ethers.getContractFactory("RibbonToken");

    rewardsToken0 = await RibbonToken.deploy(
      TOKEN_PARAMS.NAME,
      TOKEN_PARAMS.SYMBOL,
      TOKEN_PARAMS.SUPPLY,
      TOKEN_PARAMS.BENIFICIARY
    );

    await rewardsToken0.deployed();

    rewardsToken1 = await RibbonToken.deploy(
      TOKEN_PARAMS.NAME,
      TOKEN_PARAMS.SYMBOL,
      TOKEN_PARAMS.SUPPLY,
      TOKEN_PARAMS.BENIFICIARY
    );

    await rewardsToken1.deployed();

    // Get staking token (rETH-THETA)
    stakingToken = await ethers.getContractAt(
      "IERC20",
      STAKING_TOKEN_PARAMS.ADDRESS
    );

    // Get rando token
    externalRewardsToken = await ethers.getContractAt(
      "IERC20",
      EXTERNAL_TOKEN_PARAMS.ADDRESS
    );

    // Get staking rewards contract
    RibbonDualStakingRewards = await ethers.getContractFactory(
      "DualStakingRewards"
    );
    stakingRewards = await RibbonDualStakingRewards.deploy(
      owner.address,
      mockRewardsDistributionAddress.address,
      rewardsToken0.address,
      rewardsToken1.address,
      STAKING_REWARDS_rETHTHETA_PARAMS.STAKING_TOKEN
    );

    await owner.sendTransaction({
      to: TOKEN_PARAMS.BENIFICIARY,
      value: ethers.utils.parseEther("1.0"),
    });
    await owner.sendTransaction({
      to: STAKING_TOKEN_PARAMS.MAIN_HOLDER,
      value: ethers.utils.parseEther("1.0"),
    });

    // Get address of ribbon token holder
    // Allow impersonation of new account
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [TOKEN_PARAMS.BENIFICIARY],
    });
    const signer = await ethers.provider.getSigner(TOKEN_PARAMS.BENIFICIARY);

    let token0 = await ethers.getContractAt(
      "RibbonToken",
      rewardsToken0.address
    );
    rewardsToken0Owner = await token0.connect(signer);

    //set transfers to allowed
    await rewardsToken0Owner.setTransfersAllowed(true);

    let token1 = await ethers.getContractAt(
      "RibbonToken",
      rewardsToken1.address
    );
    rewardsToken1Owner = await token1.connect(signer);

    //set transfers to allowed
    await rewardsToken1Owner.setTransfersAllowed(true);

    // Get address of rETH-THETA token holder
    // Allow impersonation of new account
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [STAKING_TOKEN_PARAMS.MAIN_HOLDER],
    });
    const signer2 = await ethers.provider.getSigner(
      STAKING_TOKEN_PARAMS.MAIN_HOLDER
    );
    stakingTokenOwner = await stakingToken.connect(signer2);

    // Get address of rhegic2 token holder
    // Allow impersonation of new account
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [EXTERNAL_TOKEN_PARAMS.MAIN_HOLDER],
    });
    const signer3 = await ethers.provider.getSigner(
      EXTERNAL_TOKEN_PARAMS.MAIN_HOLDER
    );
    externalRewardsTokenOwner = await externalRewardsToken.connect(signer3);

    await stakingRewards
      .connect(owner)
      .setRewardsDistribution(mockRewardsDistributionAddress.address);
  });

  it("ensure only known functions are mutative", async () => {
    ensureOnlyExpectedMutativeFunctions({
      abi: (await hre.artifacts.readArtifact("DualStakingRewards")).abi,
      ignoreParents: ["ReentrancyGuard", "Owned"],
      expected: [
        "stake",
        "stakeFor",
        "withdraw",
        "exit",
        "getReward",
        "notifyRewardAmount",
        "setPaused",
        "setRewardsDistribution",
        "setRewardsDuration",
        "recoverERC20",
      ],
    });
  });

  describe("Constructor & Settings", () => {
    it("should set rewards token 0 on constructor", async () => {
      assert.equal(await stakingRewards.rewardsToken0(), rewardsToken0.address);
    });

    it("should set rewards token 1 on constructor", async () => {
      assert.equal(await stakingRewards.rewardsToken1(), rewardsToken1.address);
    });

    it("should staking token on constructor", async () => {
      assert.equal(await stakingRewards.stakingToken(), stakingToken.address);
    });

    it("should set owner on constructor", async () => {
      const ownerAddress = await stakingRewards.owner();
      assert.equal(ownerAddress, owner.address);
    });

    it("should set rewards distribution address on constructor", async () => {
      const rewardsDistributionAddress =
        await stakingRewards.rewardsDistribution();
      assert.equal(
        rewardsDistributionAddress,
        mockRewardsDistributionAddress.address
      );
    });
  });

  describe("Function permissions", () => {
    const rewardValue0 = toUnit("1");
    const rewardValue1 = toUnit("2");

    before(async () => {
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
    });

    it("only rewardsDistribution address can call notifyRewardAmount", async () => {
      await expect(
        stakingRewards
          .connect(mockRewardsDistributionAddress)
          .notifyRewardAmount(rewardValue0, rewardValue1)
      ).to.emit(stakingRewards, "RewardAdded");
      assert.revert(
        stakingRewards
          .connect(deployerAccount)
          .notifyRewardAmount(rewardValue0, rewardValue1),
        "Caller is not RewardsDistribution contract"
      );
    });

    it("only owner address can call setRewardsDuration", async () => {
      await fastForward(DAY * 7);
      await expect(
        stakingRewards.connect(owner).setRewardsDuration(70)
      ).to.emit(stakingRewards, "RewardsDurationUpdated");
      assert.revert(
        stakingRewards.connect(deployerAccount).setRewardsDuration(70),
        "Only the contract owner may perform this action"
      );
    });

    it("only owner address can call setPaused", async () => {
      await expect(stakingRewards.connect(owner).setPaused(true)).to.emit(
        stakingRewards,
        "PauseChanged"
      );
      assert.revert(
        stakingRewards.connect(deployerAccount).setPaused(true),
        "Only the contract owner may perform this action"
      );
    });
  });

  describe("Pausable", async () => {
    beforeEach(async () => {
      await stakingRewards.connect(owner).setPaused(true);
    });
    it("should revert calling stake() when paused", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      await assert.revert(
        stakingRewards.connect(deployerAccount).stake(totalToStake),
        "This action cannot be performed while the contract is paused"
      );
    });
    it("should not revert calling stake() when unpaused", async () => {
      await stakingRewards.connect(owner).setPaused(false);

      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);
    });
  });

  describe("External Rewards Recovery", () => {
    const amount = toUnit("5000");
    beforeEach(async () => {
      // Send ERC20 to StakingRewards Contract
      await externalRewardsTokenOwner.transfer(stakingRewards.address, amount);
      assert.bnEqual(
        await externalRewardsToken.balanceOf(stakingRewards.address),
        amount
      );
    });
    it("only owner can call recoverERC20", async () => {
      await expect(
        await stakingRewards
          .connect(owner)
          .recoverERC20(externalRewardsToken.address, amount)
      ).to.emit(stakingRewards, "Recovered");
      assert.revert(
        stakingRewards
          .connect(deployerAccount)
          .recoverERC20(externalRewardsToken.address, amount),
        "Only the contract owner may perform this action"
      );
    });
    it("should revert if recovering staking token", async () => {
      await assert.revert(
        stakingRewards
          .connect(owner)
          .recoverERC20(stakingToken.address, amount),
        "Cannot withdraw the staking token"
      );
    });
    it("should retrieve external token from StakingRewards and reduce contracts balance", async () => {
      await stakingRewards
        .connect(owner)
        .recoverERC20(externalRewardsToken.address, amount);
      assert.bnEqual(
        await externalRewardsToken.balanceOf(stakingRewards.address),
        "0"
      );
    });
    it("should retrieve external token from StakingRewards and increase owners balance", async () => {
      const ownerMOARBalanceBefore = await externalRewardsToken.balanceOf(
        owner.address
      );

      await stakingRewards
        .connect(owner)
        .recoverERC20(externalRewardsToken.address, amount);

      const ownerMOARBalanceAfter = await externalRewardsToken.balanceOf(
        owner.address
      );
      assert.bnEqual(ownerMOARBalanceAfter.sub(ownerMOARBalanceBefore), amount);
    });
    it("should emit Recovered event", async () => {
      await expect(
        stakingRewards
          .connect(owner)
          .recoverERC20(externalRewardsToken.address, amount)
      ).to.emit(stakingRewards, "Recovered");
    });
  });

  describe("lastTimeRewardApplicable()", () => {
    it("should return 0", async () => {
      assert.bnEqual(await stakingRewards.lastTimeRewardApplicable(), "0");
    });

    describe("when updated", () => {
      it("should equal last emission time", async () => {
        const tx = await stakingRewards
          .connect(mockRewardsDistributionAddress)
          .notifyRewardAmount(toUnit("1"), toUnit("1"));

        const weeksPassed = BigNumber.from(
          (await provider.getBlock(tx.blockNumber)).timestamp
        )
          .div(DAY * 7)
          .mul(DAY * 7);
        const lastTimeReward = await stakingRewards.lastTimeRewardApplicable();

        assert.equal(weeksPassed.toString(), lastTimeReward.toString());
      });
    });
  });

  describe("rewardPerToken()", () => {
    const seventyDays = DAY * 70;

    it("should return 0", async () => {
      const rewardPerToken = await stakingRewards.rewardPerToken();
      assert.bnEqual(rewardPerToken[0], "0");
      assert.bnEqual(rewardPerToken[1], "0");
    });

    it("should be 0 before next emission hit", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const totalSupply = await stakingRewards.totalSupply();
      assert.isAbove(parseInt(totalSupply), 0);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      const rewardPerToken = await stakingRewards.rewardPerToken();
      assert.bnEqual(parseInt(rewardPerToken[0]), "0");
      assert.bnEqual(parseInt(rewardPerToken[1]), "0");
    });

    it("should be > 0 when next emission hit", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const totalSupply = await stakingRewards.totalSupply();
      assert.isAbove(parseInt(totalSupply), 0);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY * 8);

      const rewardPerToken = await stakingRewards.rewardPerToken();
      assert.isAbove(parseInt(rewardPerToken[0]), 0);
      assert.isAbove(parseInt(rewardPerToken[1]), 0);
    });

    it("should be same after emission hit + 1 day", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const totalSupply = await stakingRewards.totalSupply();
      assert.isAbove(parseInt(totalSupply), 0);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY * 8);

      const rewardPerToken = await stakingRewards.rewardPerToken();

      await fastForward(DAY);
      const rewardPerToken2 = await stakingRewards.rewardPerToken();

      assert.bnEqual(parseInt(rewardPerToken[0]), parseInt(rewardPerToken2[0]));
      assert.bnEqual(parseInt(rewardPerToken[1]), parseInt(rewardPerToken2[1]));
    });

    it("should be > 2x when next emission hit twice", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const totalSupply = await stakingRewards.totalSupply();
      assert.isAbove(parseInt(totalSupply), 0);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY * 7);

      const rewardPerToken = await stakingRewards.rewardPerToken();

      await fastForward(DAY * 7);

      const rewardPerToken2 = await stakingRewards.rewardPerToken();

      assert.isAbove(parseInt(rewardPerToken[0]), 0);
      assert.isAbove(parseInt(rewardPerToken[1]), 0);
      assert.bnEqual(
        parseInt(rewardPerToken2[0]),
        parseInt(rewardPerToken[0]) * 2
      );
      assert.bnEqual(
        parseInt(rewardPerToken2[1]),
        parseInt(rewardPerToken[1]) * 2
      );
    });
  });

  describe("stake()", () => {
    it("staking increases staking balance", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const initialStakeBal = await stakingRewards.balanceOf(
        deployerAccount.address
      );
      const initialLpBal = await stakingToken.balanceOf(
        deployerAccount.address
      );

      await expect(stakingRewards.connect(deployerAccount).stake(totalToStake))
        .to.emit(stakingRewards, "Staked")
        .withArgs(
          deployerAccount.address,
          deployerAccount.address,
          totalToStake
        );

      const postStakeBal = await stakingRewards.balanceOf(
        deployerAccount.address
      );
      const postLpBal = await stakingToken.balanceOf(deployerAccount.address);

      assert.bnEqual(BigNumber.from(postLpBal).add(totalToStake), initialLpBal);
      assert.bnEqual(
        postStakeBal,
        BigNumber.from(initialStakeBal).add(totalToStake)
      );
    });

    it("cannot stake 0", async () => {
      await assert.revert(
        stakingRewards.connect(owner).stake("0"),
        "Cannot stake 0"
      );
    });
  });

  describe("stakeFor()", () => {
    it("staking increases staking balance", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(account3.address, totalToStake);
      await stakingToken
        .connect(account3)
        .approve(stakingRewards.address, totalToStake);

      const initialStakeBal = await stakingRewards.balanceOf(
        deployerAccount.address
      );
      const initialLpBal = await stakingToken.balanceOf(
        deployerAccount.address
      );
      const initialLpBalSender = await stakingToken.balanceOf(account3.address);

      await expect(
        stakingRewards
          .connect(account3)
          .stakeFor(totalToStake, deployerAccount.address)
      )
        .to.emit(stakingRewards, "Staked")
        .withArgs(deployerAccount.address, account3.address, totalToStake);

      const postStakeBal = await stakingRewards.balanceOf(
        deployerAccount.address
      );
      const postLpBal = await stakingToken.balanceOf(deployerAccount.address);
      const postLpBalSender = await stakingToken.balanceOf(account3.address);

      assert.bnEqual(postLpBal, initialLpBal);
      assert.bnEqual(
        BigNumber.from(postLpBalSender).add(totalToStake),
        initialLpBalSender
      );
      assert.bnEqual(
        postStakeBal,
        BigNumber.from(initialStakeBal).add(totalToStake)
      );
    });

    it("cannot stake 0", async () => {
      await assert.revert(
        stakingRewards.connect(owner).stakeFor("0", owner.address),
        "Cannot stake 0"
      );
    });
  });

  describe("earned()", () => {
    const seventyDays = DAY * 70;

    it("should be 0 when not staking", async () => {
      const deployerEarned = await stakingRewards.earned(
        deployerAccount.address
      );
      assert.bnEqual(deployerEarned[0], "0");
      assert.bnEqual(deployerEarned[1], "0");
    });

    it("should get 1 week of stake when staking one day after startEmission", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 7);

      const earned = await stakingRewards.earned(deployerAccount.address);

      assert.bnGt(earned[0], toUnit("1249.99"));
      assert.bnGt(earned[1], toUnit("1499.99"));

      await fastForward(DAY * 30);

      const earned1 = await stakingRewards.earned(deployerAccount.address);
      console.log(formatEther(earned1[0]), formatEther(earned1[1]));
    });

    it("should get 3 week of stake when staking one week after startEmission", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY * 1);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 30);

      const earned1 = await stakingRewards.earned(deployerAccount.address);
      console.log(earned1[0].toString(), earned1[1].toString());
    });

    it("should be 0 when staking but before emission hit", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      const earned = await stakingRewards.earned(deployerAccount.address);

      console.log(
        (await provider.getBlock("latest")).timestamp,
        (await stakingRewards.periodFinish()).toNumber()
      );

      assert.bnEqual(parseInt(earned[0]), "0");
      assert.bnEqual(parseInt(earned[1]), "0");

      await fastForward(DAY * 30);

      const earned1 = await stakingRewards.earned(deployerAccount.address);
      console.log("earned", formatEther(earned1[0]));
      console.log("earned", formatEther(earned1[1]));
    });

    it("should be > 0 when staking and after emission hit", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY * 8);

      const earned = await stakingRewards.earned(deployerAccount.address);

      assert.bnGt(earned[0], toUnit("499.999"));
      assert.bnGt(earned[1], toUnit("599.999"));
    });

    it("should be same after emission hit + 1 day", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY * 8);

      const earned = await stakingRewards.earned(deployerAccount.address);

      await fastForward(DAY);

      const earned2 = await stakingRewards.earned(deployerAccount.address);

      assert.bnEqual(parseInt(earned[0]), parseInt(earned2[0]));
      assert.bnEqual(parseInt(earned[1]), parseInt(earned2[1]));
    });

    it("should be 2x when staking and after emission hit twice", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY * 7);

      const earned = await stakingRewards.earned(deployerAccount.address);

      await fastForward(DAY * 7);

      const earned2 = await stakingRewards.earned(deployerAccount.address);

      assert.isAbove(parseInt(earned[0]), 0);
      assert.isAbove(parseInt(earned[1]), 0);
      assert.bnEqual(parseInt(earned2[0]), parseInt(earned[0]) * 2);
      assert.bnEqual(parseInt(earned2[1]), parseInt(earned[1]) * 2);
    });

    it("should be increasing 4 times throughout program", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingTokenOwner.transfer(owner.address, totalToStake);
      await stakingTokenOwner.transfer(account3.address, totalToStake);
      await stakingTokenOwner.transfer(account4.address, totalToStake);

      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingToken
        .connect(owner)
        .approve(stakingRewards.address, totalToStake);
      await stakingToken
        .connect(account3)
        .approve(stakingRewards.address, totalToStake);
      await stakingToken
        .connect(account4)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 7);

      await stakingRewards.connect(owner).stake(totalToStake);

      let deployerEarned = await stakingRewards.earned(deployerAccount.address);
      assert.isAbove(deployerEarned[0], 0);
      assert.isAbove(deployerEarned[1], 0);
      let ownerEarned = await stakingRewards.earned(owner.address);
      assert.bnEqual(ownerEarned[0], 0);
      assert.bnEqual(ownerEarned[1], 0);

      await fastForward(DAY * 7);

      await stakingRewards.connect(account3).stake(totalToStake);
      deployerEarned = await stakingRewards.earned(deployerAccount.address);
      assert.isAbove(deployerEarned[0], 0);
      assert.isAbove(deployerEarned[1], 0);
      ownerEarned = await stakingRewards.earned(owner.address);
      assert.isAbove(ownerEarned[0], 0);
      assert.isAbove(ownerEarned[1], 0);
      let account3Earned = await stakingRewards.earned(account3.address);
      assert.bnEqual(account3Earned[0], 0);
      assert.bnEqual(account3Earned[1], 0);

      await fastForward(DAY * 7);

      await stakingRewards.connect(account4).stake(totalToStake);
      deployerEarned = await stakingRewards.earned(deployerAccount.address);
      assert.isAbove(deployerEarned[0], 0);
      assert.isAbove(deployerEarned[1], 0);
      ownerEarned = await stakingRewards.earned(owner.address);
      assert.isAbove(ownerEarned[0], 0);
      assert.isAbove(ownerEarned[1], 0);
      account3Earned = await stakingRewards.earned(account3.address);
      assert.isAbove(account3Earned[0], 0);
      assert.isAbove(account3Earned[1], 0);
      let account4Earned = await stakingRewards.earned(account4.address);
      assert.bnEqual(account4Earned[0], 0);
      assert.bnEqual(account4Earned[1], 0);

      await fastForward(DAY * 7);

      deployerEarned = await stakingRewards.earned(deployerAccount.address);
      ownerEarned = await stakingRewards.earned(owner.address);
      account3Earned = await stakingRewards.earned(account3.address);
      account4Earned = await stakingRewards.earned(account4.address);

      assert.isAbove(deployerEarned[0], 0);
      assert.isAbove(deployerEarned[1], 0);
      assert.isAbove(ownerEarned[0], 0);
      assert.isAbove(ownerEarned[1], 0);
      assert.isAbove(account3Earned[0], 0);
      assert.isAbove(account3Earned[1], 0);
      assert.isAbove(account4Earned[0], 0);
      assert.isAbove(account4Earned[1], 0);

      await fastForward(DAY * 7);

      console.log(deployerEarned[0].toString(), deployerEarned[1].toString());
      console.log(ownerEarned[0].toString(), ownerEarned[1].toString());
      console.log(account3Earned[0].toString(), account3Earned[1].toString());
      console.log(account4Earned[0].toString(), account4Earned[1].toString());

      assert.isAbove(deployerEarned[0], ownerEarned[0]);
      assert.isAbove(deployerEarned[1], ownerEarned[1]);
      assert.isAbove(ownerEarned[0], account3Earned[0]);
      assert.isAbove(ownerEarned[1], account3Earned[1]);
      assert.isAbove(account3Earned[0], account4Earned[0]);
      assert.isAbove(account3Earned[1], account4Earned[1]);

      const newDeployerEarned = await stakingRewards.earned(
        deployerAccount.address
      );
      assert.bnEqual(deployerEarned[0], newDeployerEarned[0]);
      assert.bnEqual(deployerEarned[1], newDeployerEarned[1]);
      const newOwnerEarned = await stakingRewards.earned(owner.address);
      assert.bnEqual(ownerEarned[0], newOwnerEarned[0]);
      assert.bnEqual(ownerEarned[1], newOwnerEarned[1]);
      const newAccount3Earned = await stakingRewards.earned(account3.address);
      assert.bnEqual(account3Earned[0], newAccount3Earned[0]);
      assert.bnEqual(account3Earned[1], newAccount3Earned[1]);
      const newAccount4Earned = await stakingRewards.earned(account4.address);
      assert.bnEqual(account4Earned[0], newAccount4Earned[0]);
      assert.bnEqual(account4Earned[1], newAccount4Earned[1]);
    });

    it("T0 Stake", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);

      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 28);
      let deployerEarned = await stakingRewards.earned(deployerAccount.address);

      assertBNGreaterThan(deployerEarned[0], rewardValue0.mul(98).div(100));
      assertBNGreaterThan(deployerEarned[1], rewardValue1.mul(98).div(100));

      assertBNLessThan(deployerEarned[0], rewardValue0);
      assertBNLessThan(deployerEarned[1], rewardValue1);

      await fastForward(DAY * 7);

      const newDeployerEarned = await stakingRewards.earned(
        deployerAccount.address
      );
      assert.bnEqual(deployerEarned[0], newDeployerEarned[0]);
      assert.bnEqual(deployerEarned[1], newDeployerEarned[1]);
    });

    it("T1 Stake", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);

      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY * 1);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 21);
      let deployerEarned = await stakingRewards.earned(deployerAccount.address);

      console.log(deployerEarned[0].toString(), deployerEarned[1].toString());

      assertBNGreaterThan(deployerEarned[0], rewardValue0.mul(298).div(400));
      assertBNGreaterThan(deployerEarned[1], rewardValue1.mul(298).div(400));

      assertBNLessThan(deployerEarned[0], rewardValue0.mul(3).div(4));
      assertBNLessThan(deployerEarned[1], rewardValue1.mul(3).div(4));

      await fastForward(DAY * 2);

      const newDeployerEarned = await stakingRewards.earned(
        deployerAccount.address
      );
      assert.bnEqual(deployerEarned[0], newDeployerEarned[0]);
      assert.bnEqual(deployerEarned[1], newDeployerEarned[1]);
    });

    it("T2 Stake", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);

      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY * 8);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 14);
      let deployerEarned = await stakingRewards.earned(deployerAccount.address);

      console.log(deployerEarned[0].toString(), deployerEarned[1].toString());
      assertBNGreaterThan(deployerEarned[0], rewardValue0.mul(98).div(200));
      assertBNGreaterThan(deployerEarned[1], rewardValue1.mul(98).div(200));

      assertBNLessThan(deployerEarned[0], rewardValue0.mul(1).div(2));
      assertBNLessThan(deployerEarned[1], rewardValue1.mul(1).div(2));

      await fastForward(DAY * 2);

      const newDeployerEarned = await stakingRewards.earned(
        deployerAccount.address
      );
      assert.bnEqual(deployerEarned[0], newDeployerEarned[0]);
      assert.bnEqual(deployerEarned[1], newDeployerEarned[1]);
    });

    it("T3 Stake", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);

      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY * 15);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 7);
      let deployerEarned = await stakingRewards.earned(deployerAccount.address);

      console.log(deployerEarned[0].toString(), deployerEarned[1].toString());

      assertBNGreaterThan(deployerEarned[0], rewardValue0.mul(98).div(400));
      assertBNGreaterThan(deployerEarned[1], rewardValue1.mul(98).div(400));

      assertBNLessThan(deployerEarned[0], rewardValue0.mul(1).div(4));
      assertBNLessThan(deployerEarned[1], rewardValue1.mul(1).div(4));

      await fastForward(DAY * 2);

      const newDeployerEarned = await stakingRewards.earned(
        deployerAccount.address
      );
      assert.bnEqual(deployerEarned[0], newDeployerEarned[0]);
      assert.bnEqual(deployerEarned[1], newDeployerEarned[1]);
    });

    it("T4 Stake", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);

      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY * 18);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 1);
      let deployerEarned = await stakingRewards.earned(deployerAccount.address);
      console.log(deployerEarned[0].toString(), deployerEarned[1].toString());
      assert.bnEqual(deployerEarned[0], BigNumber.from(0));
      assert.bnEqual(deployerEarned[1], BigNumber.from(0));

      await fastForward(DAY * 1);

      const newDeployerEarned = await stakingRewards.earned(
        deployerAccount.address
      );
      assert.bnEqual(deployerEarned[0], newDeployerEarned[0]);
      assert.bnEqual(deployerEarned[1], newDeployerEarned[1]);
    });

    it("rewardRate should increase if new rewards come before DURATION ends", async () => {
      const totalToDistribute0 = toUnit("5000");
      const totalToDistribute1 = toUnit("6000");

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      const rewardRateInitial = await stakingRewards.rewardRate();

      await fastForward(DAY * 1);

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      const rewardRateLater = await stakingRewards.rewardRate();

      assert.isAbove(parseInt(rewardRateInitial[0]), 0);
      assert.isAbove(parseInt(rewardRateInitial[1]), 0);
      assert.isAbove(
        parseInt(rewardRateLater[0]),
        parseInt(rewardRateInitial[0])
      );
      assert.isAbove(
        parseInt(rewardRateLater[1]),
        parseInt(rewardRateInitial[1])
      );
    });

    it("rewards token balance should rollover after DURATION", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute0 = toUnit("5000");
      const totalToDistribute1 = toUnit("6000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await stakingRewards.connect(owner).setRewardsDuration(DAY * 7);

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      await fastForward(DAY * 7);
      // const earnedFirst = await stakingRewards.earned(deployerAccount.address);

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      await fastForward(DAY * 7);
      // const earnedSecond = await stakingRewards.earned(deployerAccount.address);

      // not exact match but we are not calling notifyRewardAmount
      // after liquidity mining ends (to increase duration)
      // assert.isAbove(earnedSecond, earnedFirst.add(earnedFirst));
    });
  });

  describe("getReward()", () => {
    const seventyDays = DAY * 70;

    it("rewards balance should change if getting reward BEFORE end of program", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute0 = toUnit("5000");
      const totalToDistribute1 = toUnit("6000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      const initialReward0Bal = await rewardsToken0.balanceOf(
        deployerAccount.address
      );
      const initialReward1Bal = await rewardsToken1.balanceOf(
        deployerAccount.address
      );
      const initialEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );

      await fastForward(DAY * 15);

      await stakingRewards.connect(deployerAccount).getReward();
      const postReward0Bal = await rewardsToken0.balanceOf(
        deployerAccount.address
      );
      const postReward1Bal = await rewardsToken1.balanceOf(
        deployerAccount.address
      );
      const postEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );

      assert.equal(
        parseInt(postEarnedBal[0].toString()),
        parseInt(initialEarnedBal[0].toString())
      );
      assert.equal(
        parseInt(postEarnedBal[1].toString()),
        parseInt(initialEarnedBal[1].toString())
      );
      assert.isAbove(
        parseInt(postReward0Bal.toString()),
        parseInt(initialReward0Bal.toString())
      );
      assert.isAbove(
        parseInt(postReward1Bal.toString()),
        parseInt(initialReward1Bal.toString())
      );
    });

    it("rewards balance should changed if getting reward BEFORE end of program", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute0 = toUnit("5000");
      const totalToDistribute1 = toUnit("6000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      const initialReward0Bal = await rewardsToken0.balanceOf(
        deployerAccount.address
      );
      const initialReward1Bal = await rewardsToken1.balanceOf(
        deployerAccount.address
      );
      const initialEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );

      await fastForward(DAY * 28);

      await stakingRewards.connect(deployerAccount).getReward();
      const postReward0Bal = await rewardsToken0.balanceOf(
        deployerAccount.address
      );
      const postReward1Bal = await rewardsToken1.balanceOf(
        deployerAccount.address
      );
      const postEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );

      console.log(
        `post earned bal is ${postEarnedBal[0].toString()}, ${postEarnedBal[1].toString()}`
      );
      console.log(
        `post reward bal is ${postReward0Bal.toString()}, ${postReward1Bal.toString()}`
      );

      assert.equal(
        parseInt(postEarnedBal[0].toString()),
        parseInt(initialEarnedBal[0].toString())
      );
      assert.equal(
        parseInt(postEarnedBal[1].toString()),
        parseInt(initialEarnedBal[1].toString())
      );
      assert.isAbove(
        parseInt(postReward0Bal.toString()),
        parseInt(initialReward0Bal.toString())
      );
      assert.isAbove(
        parseInt(postReward1Bal.toString()),
        parseInt(initialReward1Bal.toString())
      );
    });

    it("should increase rewards token balance", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute0 = toUnit("5000");
      const totalToDistribute1 = toUnit("6000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      await fastForward(DAY * 81);

      const initialReward0Bal = await rewardsToken0.balanceOf(
        deployerAccount.address
      );
      const initialReward1Bal = await rewardsToken1.balanceOf(
        deployerAccount.address
      );
      const initialEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );
      await stakingRewards.connect(deployerAccount).getReward();
      const postReward0Bal = await rewardsToken0.balanceOf(
        deployerAccount.address
      );
      const postReward1Bal = await rewardsToken1.balanceOf(
        deployerAccount.address
      );
      const postEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );

      assert.isAbove(
        parseInt(initialEarnedBal[0].toString()),
        parseInt(postEarnedBal[0].toString())
      );
      assert.isAbove(
        parseInt(initialEarnedBal[1].toString()),
        parseInt(postEarnedBal[1].toString())
      );
      assert.isAbove(
        parseInt(postReward0Bal.toString()),
        parseInt(initialReward0Bal.toString())
      );
      assert.isAbove(
        parseInt(postReward1Bal.toString()),
        parseInt(initialReward1Bal.toString())
      );
    });
  });

  describe("setRewardsDuration()", () => {
    const twentyEightDays = DAY * 28;
    const seventyDays = DAY * 70;
    it("should increase rewards duration before starting distribution", async () => {
      const defaultDuration = await stakingRewards.rewardsDuration();
      assert.bnEqual(defaultDuration, twentyEightDays);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);
      const newDuration = await stakingRewards.rewardsDuration();
      assert.bnEqual(newDuration, seventyDays);
    });
    it("should revert when setting setRewardsDuration before the period has finished", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute0 = toUnit("5000");
      const totalToDistribute1 = toUnit("6000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      await fastForward(DAY);

      await assert.revert(
        stakingRewards.connect(owner).setRewardsDuration(seventyDays),
        "Previous rewards period must be complete before changing the duration for the new period"
      );
    });

    it("should update when setting setRewardsDuration after the period has finished", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute0 = toUnit("5000");
      const totalToDistribute1 = toUnit("6000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      await fastForward(DAY * 31);

      await expect(
        stakingRewards.connect(owner).setRewardsDuration(seventyDays)
      ).to.emit(stakingRewards, "RewardsDurationUpdated");

      const newDuration = await stakingRewards.rewardsDuration();
      assert.bnEqual(newDuration, seventyDays);

      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);
    });

    it("should update when setting setRewardsDuration after the period has finished", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute0 = toUnit("5000");
      const totalToDistribute1 = toUnit("6000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      await fastForward(DAY * 4);
      await stakingRewards.connect(deployerAccount).getReward();
      await fastForward(DAY * 27);

      // New Rewards period much lower
      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await expect(
        stakingRewards.connect(owner).setRewardsDuration(seventyDays)
      ).to.emit(stakingRewards, "RewardsDurationUpdated");

      const newDuration = await stakingRewards.rewardsDuration();
      assert.bnEqual(newDuration, seventyDays);

      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      await fastForward(DAY * 71);
      await stakingRewards.connect(deployerAccount).getReward();
    });
  });

  describe("getRewardForDuration()", () => {
    it("should increase rewards token balance", async () => {
      const totalToDistribute0 = toUnit("5000");
      const totalToDistribute1 = toUnit("5000");
      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      const rewardForDuration = await stakingRewards.getRewardForDuration();

      const duration = await stakingRewards.rewardsDuration();
      const rewardRate = await stakingRewards.rewardRate();

      assert.isAbove(rewardForDuration[0], 0);
      assert.isAbove(rewardForDuration[1], 0);
      assert.bnEqual(rewardForDuration[0], duration.mul(rewardRate[0]));
      assert.bnEqual(rewardForDuration[1], duration.mul(rewardRate[1]));
    });
  });

  describe("withdraw()", () => {
    it("cannot withdraw if nothing staked", async () => {
      await expect(stakingRewards.connect(owner).withdraw(toUnit("100"))).to.be
        .reverted;
    });

    it("rewards should remain unchanged if withdrawing BEFORE end of mining program", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute0 = toUnit("5000");
      const totalToDistribute1 = toUnit("6000");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 15);

      await stakingRewards.connect(deployerAccount).withdraw(totalToStake);

      const deployerRewards = await stakingRewards.rewards(
        deployerAccount.address
      );
      assert.bnLt(BigNumber.from(0), deployerRewards[0]);
      assert.bnLt(BigNumber.from(0), deployerRewards[1]);
    });

    it("rewards should remain unchanged if withdrawing AFTER end of mining program", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute0 = toUnit("10");
      const totalToDistribute1 = toUnit("20");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 41);

      await stakingRewards.connect(deployerAccount).withdraw(totalToStake);

      const deployerRewards = await stakingRewards.rewards(
        deployerAccount.address
      );
      assert.bnLt(BigNumber.from(0), deployerRewards[0]);
      assert.bnLt(BigNumber.from(0), deployerRewards[1]);
    });

    it("should increases lp token balance and decreases staking balance", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const initialStakingTokenBal = await stakingToken.balanceOf(
        deployerAccount.address
      );
      const initialStakeBal = await stakingRewards.balanceOf(
        deployerAccount.address
      );

      await stakingRewards.connect(deployerAccount).withdraw(totalToStake);

      const postStakingTokenBal = await stakingToken.balanceOf(
        deployerAccount.address
      );
      const postStakeBal = await stakingRewards.balanceOf(
        deployerAccount.address
      );

      assert.equal(
        BigNumber.from(postStakeBal)
          .add(BigNumber.from(totalToStake))
          .toString(),
        initialStakeBal.toString()
      );
      assert.equal(
        BigNumber.from(initialStakingTokenBal)
          .add(BigNumber.from(totalToStake))
          .toString(),
        postStakingTokenBal.toString()
      );
    });

    it("cannot withdraw 0", async () => {
      await assert.revert(
        stakingRewards.connect(owner).withdraw("0"),
        "Cannot withdraw 0"
      );
    });
  });

  describe("exit()", () => {
    const seventyDays = DAY * 70;
    it("should retrieve all earned and increase rewards bal", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute0 = toUnit("5000");
      const totalToDistribute1 = toUnit("6000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await rewardsToken0Owner.transfer(
        stakingRewards.address,
        totalToDistribute0
      );
      await rewardsToken1Owner.transfer(
        stakingRewards.address,
        totalToDistribute1
      );

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute0, totalToDistribute1);

      await fastForward(DAY * 81);

      const initialReward0Bal = await rewardsToken0.balanceOf(
        deployerAccount.address
      );
      const initialReward1Bal = await rewardsToken1.balanceOf(
        deployerAccount.address
      );
      const initialEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );
      await stakingRewards.connect(deployerAccount).exit();
      const postReward0Bal = await rewardsToken0.balanceOf(
        deployerAccount.address
      );
      const postReward1Bal = await rewardsToken1.balanceOf(
        deployerAccount.address
      );
      const postEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );

      assert.bnLt(postEarnedBal[0], initialEarnedBal[0]);
      assert.bnLt(postEarnedBal[1], initialEarnedBal[1]);
      assert.bnGt(postReward0Bal, initialReward0Bal);
      assert.bnGt(postReward1Bal, initialReward1Bal);
      assert.bnEqual(postEarnedBal[0], "0");
      assert.bnEqual(postEarnedBal[1], "0");
    });
  });

  describe("notifyRewardAmount()", () => {
    let localStakingRewards: Contract;

    before(async () => {
      localStakingRewards = await RibbonDualStakingRewards.deploy(
        owner.address,
        mockRewardsDistributionAddress.address,
        rewardsToken0.address,
        rewardsToken1.address,
        STAKING_REWARDS_rETHTHETA_PARAMS.STAKING_TOKEN
      );

      await localStakingRewards
        .connect(owner)
        .setRewardsDistribution(mockRewardsDistributionAddress.address);
    });

    it("Reverts if the provided reward is greater than the balance.", async () => {
      const rewardValue0 = toUnit(1000);
      const rewardValue1 = toUnit(2000);
      await rewardsToken0Owner.transfer(
        localStakingRewards.address,
        rewardValue0
      );
      await rewardsToken1Owner.transfer(
        localStakingRewards.address,
        rewardValue1
      );
      await assert.revert(
        localStakingRewards
          .connect(mockRewardsDistributionAddress)
          .notifyRewardAmount(
            rewardValue0.add(toUnit(0.1)),
            rewardValue0.add(toUnit(0.1))
          ),
        "Provided reward0 too high"
      );
    });

    it("Reverts if the provided reward is greater than the balance, plus rolled-over balance", async () => {
      const rewardValue0 = toUnit(1000);
      const rewardValue1 = toUnit(2000);
      let rewardsToken0Balance = await rewardsToken0.balanceOf(
        localStakingRewards.address
      );
      if (rewardValue0.gt(rewardsToken0Balance)) {
        await rewardsToken0Owner.transfer(
          localStakingRewards.address,
          rewardValue0.sub(rewardsToken0Balance)
        );
      }
      let rewardsToken1Balance = await rewardsToken1.balanceOf(
        localStakingRewards.address
      );
      if (rewardValue1.gt(rewardsToken1Balance)) {
        await rewardsToken1Owner.transfer(
          localStakingRewards.address,
          rewardValue1.sub(rewardsToken1Balance)
        );
      }
      localStakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);
      rewardsToken0Balance = await rewardsToken0.balanceOf(
        localStakingRewards.address
      );
      if (rewardValue0.gt(rewardsToken0Balance)) {
        await rewardsToken0Owner.transfer(
          localStakingRewards.address,
          rewardValue0.sub(rewardsToken0Balance)
        );
      }
      rewardsToken1Balance = await rewardsToken1.balanceOf(
        localStakingRewards.address
      );
      if (rewardValue1.gt(rewardsToken1Balance)) {
        await rewardsToken1Owner.transfer(
          localStakingRewards.address,
          rewardValue1.sub(rewardsToken1Balance)
        );
      }
      // Now take into account any leftover quantity.
      await assert.revert(
        localStakingRewards
          .connect(mockRewardsDistributionAddress)
          .notifyRewardAmount(
            rewardValue0.add(toUnit(0.1)),
            rewardValue1.add(toUnit(0.1))
          ),
        "Provided reward0 too high"
      );
    });

    it("Should allow rewards for secondary token to be added later on", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(0);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(DAY);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 7);

      const earned = await stakingRewards.earned(deployerAccount.address);

      assert.bnGt(earned[0], toUnit("1249.99"));
      assert.bnEqual(earned[1], 0);

      const rewardValue2 = toUnit(0);
      const rewardValue3 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue2);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue3);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue2, rewardValue3);

      await fastForward(DAY * 7);

      const earned1 = await stakingRewards.earned(deployerAccount.address);
      assert.bnGt(earned1[0], toUnit("1843.58"));
      assert.bnGt(earned1[1], toUnit("1499.99"));
    });

    it("Should create monthly staking periods", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardsDuration = DAY * 26;
      const month = DAY * 30;

      await stakingRewards.connect(owner).setRewardsDuration(rewardsDuration);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const rewardValue0 = toUnit(5000);
      const rewardValue1 = toUnit(6000);
      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(month);

      const rewardRate0 = await stakingRewards.rewardRate();
      const earned0 = await stakingRewards.earned(deployerAccount.address);

      await rewardsToken0Owner.transfer(stakingRewards.address, rewardValue0);
      await rewardsToken1Owner.transfer(stakingRewards.address, rewardValue1);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue0, rewardValue1);

      await fastForward(month);

      const rewardRate1 = await stakingRewards.rewardRate();
      const earned1 = await stakingRewards.earned(deployerAccount.address);

      assert.bnEqual(rewardRate0[0], rewardRate1[0]);
      assert.bnEqual(rewardRate0[1], rewardRate1[1]);
      assert.bnEqual(earned1[0].sub(earned0[0]), earned0[0]);
      assert.bnEqual(earned1[1].sub(earned0[1]), earned0[1]);

      const rewardsToken0Balance = await rewardsToken0.balanceOf(
        deployerAccount.address
      );
      const rewardsToken1Balance = await rewardsToken1.balanceOf(
        deployerAccount.address
      );

      await stakingRewards.connect(deployerAccount).getReward();

      assert.bnEqual(
        (await rewardsToken0.balanceOf(deployerAccount.address)).sub(
          rewardsToken0Balance
        ),
        earned1[0]
      );
      assert.bnEqual(
        (await rewardsToken1.balanceOf(deployerAccount.address)).sub(
          rewardsToken1Balance
        ),
        earned1[1]
      );
    });
  });
});
