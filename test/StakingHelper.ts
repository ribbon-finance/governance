import { Contract, ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers, network } from "hardhat";
import { currentTime, toUnit } from "./utils";
import { assert } from "./common";
import { expect } from "chai";

const {
  TOKEN_PARAMS,
  STAKING_REWARDS_rETHTHETA_PARAMS,
  STAKING_TOKEN_PARAMS,
} = require("../params");

describe("StakingRewards contract", function () {
  let RibbonToken: ContractFactory;
  let RibbonStakingRewards: ContractFactory;
  let StakingHelper: ContractFactory;
  let owner: SignerWithAddress;
  let mockRewardsDistributionAddress: SignerWithAddress;

  let rewardsToken: Contract,
    rewardsTokenOwner: Contract,
    stakingToken: Contract,
    stakingTokenOwner: Contract,
    stakingRewards: Contract,
    stakingHelper: Contract;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [{
        forking: {
          jsonRpcUrl: process.env.AVAX_URI,
          blockNumber: 8366494,
        },
      }],
    });

    [
      owner,
      mockRewardsDistributionAddress,
    ] = await ethers.getSigners();

    // Get rewards token (RIBBON)
    RibbonToken = await ethers.getContractFactory("RibbonToken");
    rewardsToken = await RibbonToken.deploy(
      TOKEN_PARAMS.NAME,
      TOKEN_PARAMS.SYMBOL,
      TOKEN_PARAMS.SUPPLY,
      TOKEN_PARAMS.BENIFICIARY
    );

    await rewardsToken.deployed();

    // Get staking token (rETH-THETA)
    stakingToken = await ethers.getContractAt(
      "IERC20",
      "0x98d03125c62dae2328d9d3cb32b7b969e6a87787",
    );

    const startEmission = ((await currentTime()) + 1000).toString();

    // Get staking rewards contract
    RibbonStakingRewards = await ethers.getContractFactory("StakingRewards");
    stakingRewards = await RibbonStakingRewards.deploy(
      owner.address,
      mockRewardsDistributionAddress.address,
      rewardsToken.address,
      stakingToken.address,
      startEmission
    );

    // Get staking helper contract
    StakingHelper = await ethers.getContractFactory("StakingHelper");
    stakingHelper = await StakingHelper.deploy(
      stakingToken.address,
      '0x98d03125c62DaE2328D9d3cb32b7B969e6a87787',  // Vault address on avax, rAVAX-USDC
      stakingRewards.address,
    );

    await owner.sendTransaction({
      to: STAKING_TOKEN_PARAMS.MAIN_HOLDER,
      value: ethers.utils.parseEther("1.0"),
    });

    // Get address of rETH-THETA token holder
    // Allow impersonation of new account
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [STAKING_TOKEN_PARAMS.MAIN_HOLDER],
    });
    const signer2 = await ethers.provider.getSigner(
      STAKING_TOKEN_PARAMS.MAIN_HOLDER
    );
    stakingTokenOwner = await stakingToken.connect(signer2);
  });

  describe("stake()", () => {
    it("Uses the staking helper redeem + stake", async () => {
      const de = '0xd4816D144C005B29dF24C8eb1865fB8A1e79FdDE';
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [de],
      });
      const deSigner = await ethers.provider.getSigner(de);

      const totalToStake = "10"; //toUnit("1");
      await stakingToken.connect(deSigner).approve(stakingHelper.address, totalToStake);
      await stakingHelper.connect(deSigner).stake(totalToStake);
    });
  });
});
