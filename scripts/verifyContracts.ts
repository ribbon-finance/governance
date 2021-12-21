import { TaskArguments } from "hardhat/types";
const hre = require("hardhat");
const { VOTINGLOCKUP_PARAMS, AIRDROP_PARAMS } = require("../params");

const main = async (
  _taskArgs: TaskArguments,
  { deployments, network, run }
) => {
  const chainId = network.config.chainId;
  const IncentivisedVotingLockup = await deployments.get(
    "IncentivisedVotingLockup"
  );

  const [deployer] = await hre.ethers.getSigners();

  const stakingToken =
    chainId === 42
      ? "0x567e482AF973187648Af9FC56d2Caec212c1CAca"
      : AIRDROP_PARAMS.TOKEN_ADDRESS;

  const owner = chainId === 42 ? deployer.address : VOTINGLOCKUP_PARAMS.OWNER;

  const redeemer =
    chainId === 42
      ? "0x4BD6AaA1461501b7B15a3a303d4a25d665C12f99"
      : VOTINGLOCKUP_PARAMS.REDEEMER;

  const INCENTIVISED_VOTING_LOCKUP_ARGS = [stakingToken, owner, redeemer];

  try {
    await run("verify:verify", {
      address: IncentivisedVotingLockup.address,
      constructorArguments: INCENTIVISED_VOTING_LOCKUP_ARGS,
    });
  } catch (e) {
    console.error(e);
  }
};
export default main;
