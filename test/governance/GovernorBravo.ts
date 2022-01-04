/**
 * Credit to Uniswap
 */
import chai, { expect } from "chai";
import { Contract, constants } from "ethers";
import { solidity, MockProvider, createFixtureLoader } from "ethereum-waffle";

import { governanceFixture } from "./fixtures";
import { DELAY } from "./utils";

chai.use(solidity);

describe("GovernorBravo", () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: "istanbul",
      mnemonic: "horn horn horn horn horn horn horn horn horn horn horn horn",
      gasLimit: 9999999,
    },
  });
  const [wallet] = provider.getWallets();
  const loadFixture = createFixtureLoader([wallet], provider);

  let sRBN: Contract;
  let timelock: Contract;
  let governorBravo: Contract;
  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture);
    sRBN = fixture.sRBN;
    timelock = fixture.timelock;
    governorBravo = fixture.governorBravo;
  });

  it("sRBN", async () => {
    const balance = await sRBN["balanceOf(address)"](wallet.address);
    const totalSupply = await sRBN["totalSupply()"]()
    expect(balance).to.be.eq(totalSupply);
  });

  it("timelock", async () => {
    const admin = await timelock.admin();
    expect(admin).to.be.eq(governorBravo.address);
    const pendingAdmin = await timelock.pendingAdmin();
    expect(pendingAdmin).to.be.eq(constants.AddressZero);
    const delay = await timelock.delay();
    expect(delay).to.be.eq(DELAY);
  });

  it("governor", async () => {
    const votingPeriod = await governorBravo.votingPeriod();
    expect(votingPeriod).to.be.eq(40320);
    const timelockAddress = await governorBravo.timelock();
    expect(timelockAddress).to.be.eq(timelock.address);
    const sRBNFromGovernor = await governorBravo.sRBN();
    expect(sRBNFromGovernor).to.be.eq(sRBN.address);
  });
});
