const { ethers, artifacts } = require("hardhat");
const { currentTime, fastForward } = require("../test/utils")();
import BalanceTree from "../scripts/helpers/balance-tree";

const RIBBON_TOKEN_ADDRESS = "0x567e482AF973187648Af9FC56d2Caec212c1CAca";
const MERKLE_DISTRIBUTOR_ADDRESS = "0x49C572874Cd6A7Cd1A69BD56557bF62CC949D61E" //"0xF1CF0090BDF8eDDFF366303AB89b514932de5B2E";

async function main() {
  const [owner] = await ethers.getSigners();

  console.log("Transferring tokens to merkle distributor contract...");

  let tokenSigner = (
    await ethers.getContractAt("RibbonToken", RIBBON_TOKEN_ADDRESS)
  ).connect(owner);
  await tokenSigner.transfer(MERKLE_DISTRIBUTOR_ADDRESS, 1000000, {
    from: owner.address,
  });

  console.log("Token transfer to merkle distributor successful...");
  console.log("Giving merkle airdrop transfer privileges...");

  await tokenSigner.grantRole(
    await tokenSigner.TRANSFER_ROLE(),
    MERKLE_DISTRIBUTOR_ADDRESS
  );

  console.log("Merkle airdrop transfer privileges granted...");
  console.log("Claiming airdrop amount from merkle distributor contract...");


  let index = 0;
  let account = "0x371E0d225b751C1d6B3554db72609D893AbFeCcB"
  let amount = 500

  let tree = new BalanceTree([
    { account: "0x371E0d225b751C1d6B3554db72609D893AbFeCcB", amount: ethers.BigNumber.from(500) },
    { account: "0x546Cd75bAA94603D6790CD2E6058fa0A84C52165", amount: ethers.BigNumber.from(200) },
    { account: "0xc62DC8D0Fa2dB60ECA118984067c6ad011Bf598A", amount: ethers.BigNumber.from(100) },
  ]);

  let proof = tree.getProof(0, "0x371E0d225b751C1d6B3554db72609D893AbFeCcB", ethers.BigNumber.from(500))

  console.log(`Merkle root is ${tree.getHexRoot()}`)
  console.log(`Merkle proof is ${proof}`)

  let merkleSigner = (
    await ethers.getContractAt("MerkleDistributor", MERKLE_DISTRIBUTOR_ADDRESS)
  ).connect(owner);

  let resp = await merkleSigner.claim(index, account, amount, proof);

  console.log(`Claim sucessful!`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
