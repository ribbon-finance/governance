const { ethers, artifacts } = require("hardhat");
const { currentTime, fastForward } = require("../test/utils")();
import BalanceTree from "../scripts/helpers/balance-tree";

const RIBBON_TOKEN_ADDRESS = "0x567e482AF973187648Af9FC56d2Caec212c1CAca";
const MERKLE_DISTRIBUTOR_ADDRESS = "0xF1CF0090BDF8eDDFF366303AB89b514932de5B2E";

async function main() {
  const [owner, claimee2] = await ethers.getSigners();

  console.log("Transferring tokens to merkle distributor contract...");

  let tokenSigner = (
    await ethers.getContractAt("RibbonToken", RIBBON_TOKEN_ADDRESS)
  ).connect(owner);
  await tokenSigner.transfer(MERKLE_DISTRIBUTOR_ADDRESS, 100000, {
    from: owner.address,
  });

  console.log("Token transfer to merkle distributor successful...");
  console.log("Claiming airdrop amount from merkle distributor contract");

  let tree = new BalanceTree([
    { account: claimee2.address, amount: ethers.BigNumber.from(200) },
    { account: owner.address, amount: ethers.BigNumber.from(100) },
  ]);

  let index = 0;
  let account = claimee2.address;
  let amount = 200
  //let proof = ['0x0efae0319abb6354392ae2b02357d688c57f27a0d21e7d9821c39d2c71d8c83b'];
  let proof = tree.getProof(0, claimee2.address, ethers.BigNumber.from(200))

  console.log(`Merkle root is ${tree.getHexRoot()}`)
  console.log(`Merkle proof is ${proof}`)

  let merkleSigner = (
    await ethers.getContractAt("MerkleDistributor", MERKLE_DISTRIBUTOR_ADDRESS)
  ).connect(owner);

  let resp = await merkleSigner.claim(index, account, amount, proof);

  console.log(`Claim sucessful! ${res}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
