import { ethers } from "hardhat";
import chai, { expect } from "chai";
import { Contract } from "ethers";
import { solidity } from "ethereum-waffle";

import { parseEther } from "@ethersproject/units";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

chai.use(solidity);

interface GovernanceFixture {
  sRBN: Contract;
  timelock: Contract;
  governorBravo: Contract;
  admin: SignerWithAddress;
}

const DAO_MULTISIG = "0xDAEada3d210D2f45874724BeEa03C7d4BBD41674";

const VOTING_PERIOD = 40320; // half a day

const VOTING_DELAY = 1;

const PROPOSAL_THRESHOLD = parseEther("50000");

const TIMELOCK_DELAY = 172800; // 48 hours

export async function governanceFixture(): Promise<GovernanceFixture> {
  const [admin] = await ethers.getSigners();

  // Contract factories
  const RibbonToken = await ethers.getContractFactory("RibbonToken");
  const StakedRibbon = await ethers.getContractFactory(
    "VotingEscrow"
  );
  const GovernorBravoDelegate = await ethers.getContractFactory(
    "GovernorBravoDelegate"
  );
  const GovernorBravoDelegator = await ethers.getContractFactory(
    "GovernorBravoDelegator"
  );
  const Timelock = await ethers.getContractFactory("Timelock");

  const rbn = await RibbonToken.deploy("Ribbon", "RBN", 100, admin.address);

  const sRBN = await StakedRibbon.deploy(
    rbn.address,
    "Vote-escrowed RBN",
    "veRBN",
    admin.address
  );

  const governorBravoDelegate = await GovernorBravoDelegate.deploy();

  // Using nonces we get the pre-determined addresses for timelock and governor
  const governorNonce = await ethers.provider.getTransactionCount(
    admin.address
  );
  const timelockNonce = governorNonce + 1;
  const governorAddress = Contract.getContractAddress({
    from: admin.address,
    nonce: governorNonce,
  });
  const timelockAddress = Contract.getContractAddress({
    from: admin.address,
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

  const governorBravo = new ethers.Contract(
    governorBravoDelegator.address,
    governorBravoDelegate.interface,
    ethers.provider
  );

  return { sRBN, timelock, governorBravo, admin };
}
