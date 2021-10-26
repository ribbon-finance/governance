import { ethers } from "hardhat";
import chai, { expect } from "chai";
import { Contract } from "ethers";
import { solidity } from "ethereum-waffle";

import { parseEther } from "@ethersproject/units";

chai.use(solidity);

interface GovernanceFixture {
  sRBN: Contract;
  timelock: Contract;
  governorBravo: Contract;
}

const DAO_MULTISIG = "0xDAEada3d210D2f45874724BeEa03C7d4BBD41674";

const VOTING_PERIOD = 5760; // 24 hours

const VOTING_DELAY = 1;

const PROPOSAL_THRESHOLD = parseEther("50000");

const TIMELOCK_DELAY = 604800;

export async function governanceFixture(): Promise<GovernanceFixture> {
  const [minter] = await ethers.getSigners();

  // Contract factories
  const StakedRibbon = await ethers.getContractFactory("StakedRibbon");
  const GovernorBravoDelegate = await ethers.getContractFactory(
    "GovernorBravoDelegate"
  );
  const GovernorBravoDelegator = await ethers.getContractFactory(
    "GovernorBravoDelegator"
  );
  const Timelock = await ethers.getContractFactory("Timelock");

  const sRBN = await StakedRibbon.deploy(minter.address);

  const governorBravoDelegate = await GovernorBravoDelegate.deploy();

  // Using nonces we get the pre-determined addresses for timelock and governor
  const governorNonce = await ethers.provider.getTransactionCount(
    minter.address
  );
  const timelockNonce = governorNonce + 1;
  const governorAddress = Contract.getContractAddress({
    from: minter.address,
    nonce: governorNonce,
  });
  const timelockAddress = Contract.getContractAddress({
    from: minter.address,
    nonce: timelockNonce,
  });

  const governorBravoDelegator = await GovernorBravoDelegator.deploy(
    timelockAddress,
    sRBN.address,
    DAO_MULTISIG,
    governorBravoDelegate.address,
    VOTING_PERIOD,
    VOTING_DELAY,
    PROPOSAL_THRESHOLD
  );
  expect(governorBravoDelegator.address).to.be.eq(governorAddress);

  const timelock = await Timelock.deploy(governorAddress, TIMELOCK_DELAY);
  expect(timelock.address).to.be.eq(timelockAddress);

  return { sRBN, timelock, governorBravo: governorBravoDelegator };
}
