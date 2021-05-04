import("@nomiclabs/hardhat-waffle");
import { ethers } from "hardhat";
import chai, { expect } from "chai";
import { MockProvider } from "ethereum-waffle";
import { parseBalanceMap } from "../scripts/helpers/parse-balance-map";
import BalanceTree from "../scripts/helpers/balance-tree";
import { BigNumber, constants, Contract, ContractFactory } from "ethers";

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("MerkleDistributor contract", function () {
  let TestERC20: ContractFactory;
  let Distributor: ContractFactory;
  let token: Contract;
  let distributor: Contract;

  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: "istanbul",
      mnemonic: "horn horn horn horn horn horn horn horn horn horn horn horn",
      gasLimit: 9999999,
    },
  });

  const wallets = provider.getWallets();
  const [wallet0, wallet1] = wallets;

  beforeEach("deploy token", async () => {
    // wallets = await ethers.getSigners()
    // // get signers
    // [wallet0, wallet1] = wallets;

    // deploy token
    TestERC20 = await ethers.getContractFactory("TestERC20");
    token = await TestERC20.deploy("Token", "TKN", 0);

    await token.deployed();

    // deploy merkle distributor
    Distributor = await ethers.getContractFactory("MerkleDistributor");
    distributor = await Distributor.deploy(token.address, ZERO_BYTES32);
    await distributor.deployed();
  });

  describe("#token", () => {
    it("returns the token address", async () => {
      expect(await distributor.token()).to.equal(token.address);
    });
  });

  describe("#merkleRoot", () => {
    it("returns the zero merkle root", async () => {
      expect(await distributor.merkleRoot()).to.equal(ZERO_BYTES32);
    });
  });

  describe("#claim", () => {
    it("fails for empty proof", async () => {
      await expect(
        distributor.claim(0, wallet0.address, 10, [])
      ).to.be.revertedWith("MerkleDistributor: Invalid proof.");
    });

    it("fails for invalid index", async () => {
      await expect(
        distributor.claim(0, wallet0.address, 10, [])
      ).to.be.revertedWith("MerkleDistributor: Invalid proof.");
    });

    describe("two account tree", () => {
      let localDistributor: Contract;
      let tree: BalanceTree;
      beforeEach("deploy", async () => {
        tree = new BalanceTree([
          { account: wallet0.address, amount: BigNumber.from(100) },
          { account: wallet1.address, amount: BigNumber.from(101) },
        ]);
        localDistributor = await Distributor.deploy(
          token.address,
          tree.getHexRoot()
        );
        await localDistributor.deployed();
        await token.setBalance(localDistributor.address, 201);
      });

      it("successful claim", async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100));
        await expect(localDistributor.claim(0, wallet0.address, 100, proof0))
          .to.emit(localDistributor, "Claimed")
          .withArgs(0, wallet0.address, 100);
        const proof1 = tree.getProof(1, wallet1.address, BigNumber.from(101));
        await expect(localDistributor.claim(1, wallet1.address, 101, proof1))
          .to.emit(localDistributor, "Claimed")
          .withArgs(1, wallet1.address, 101);
      });

      it("transfers the token", async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100));
        expect(await token.balanceOf(wallet0.address)).to.equal(0);
        await localDistributor.claim(0, wallet0.address, 100, proof0);
        expect(await token.balanceOf(wallet0.address)).to.equal(100);
      });

      it("must have enough to transfer", async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100));
        await token.setBalance(localDistributor.address, 99);
        await expect(
          localDistributor.claim(0, wallet0.address, 100, proof0)
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("sets #isClaimed", async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100));
        expect(await localDistributor.isClaimed(0)).to.equal(false);
        expect(await localDistributor.isClaimed(1)).to.equal(false);
        await localDistributor.claim(0, wallet0.address, 100, proof0);
        expect(await localDistributor.isClaimed(0)).to.equal(true);
        expect(await localDistributor.isClaimed(1)).to.equal(false);
      });

      it("cannot allow two claims", async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100));
        await localDistributor.claim(0, wallet0.address, 100, proof0);
        await expect(
          localDistributor.claim(0, wallet0.address, 100, proof0)
        ).to.be.revertedWith("MerkleDistributor: Drop already claimed.");
      });

      it("cannot claim more than once: 0 and then 1", async () => {
        await localDistributor.claim(
          0,
          wallet0.address,
          100,
          tree.getProof(0, wallet0.address, BigNumber.from(100))
        );
        await localDistributor.claim(
          1,
          wallet1.address,
          101,
          tree.getProof(1, wallet1.address, BigNumber.from(101))
        );

        await expect(
          localDistributor.claim(
            0,
            wallet0.address,
            100,
            tree.getProof(0, wallet0.address, BigNumber.from(100))
          )
        ).to.be.revertedWith("MerkleDistributor: Drop already claimed.");
      });

      it("cannot claim more than once: 1 and then 0", async () => {
        await localDistributor.claim(
          1,
          wallet1.address,
          101,
          tree.getProof(1, wallet1.address, BigNumber.from(101))
        );
        await localDistributor.claim(
          0,
          wallet0.address,
          100,
          tree.getProof(0, wallet0.address, BigNumber.from(100))
        );

        await expect(
          localDistributor.claim(
            1,
            wallet1.address,
            101,
            tree.getProof(1, wallet1.address, BigNumber.from(101))
          )
        ).to.be.revertedWith("MerkleDistributor: Drop already claimed.");
      });

      it("cannot claim for address other than proof", async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100));
        await expect(
          localDistributor.claim(1, wallet1.address, 101, proof0)
        ).to.be.revertedWith("MerkleDistributor: Invalid proof.");
      });

      it("cannot claim more than proof", async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100));
        await expect(
          localDistributor.claim(0, wallet0.address, 101, proof0)
        ).to.be.revertedWith("MerkleDistributor: Invalid proof.");
      });

      it("gas", async () => {
        const proof = tree.getProof(0, wallet0.address, BigNumber.from(100));
        const tx = await localDistributor.claim(0, wallet0.address, 100, proof);
        const receipt = await tx.wait();
        expect(receipt.gasUsed).to.equal(79137);
      });
    });
    describe("larger tree", () => {
      let localDistributor: Contract;
      let tree: BalanceTree;
      beforeEach("deploy", async () => {
        tree = new BalanceTree(
          wallets.map((wallet, ix) => {
            return { account: wallet.address, amount: BigNumber.from(ix + 1) };
          })
        );
        localDistributor = await Distributor.deploy(
          token.address,
          tree.getHexRoot()
        );
        await localDistributor.deployed();
        await token.setBalance(localDistributor.address, 201);
      });

      it("claim index 1", async () => {
        const proof = tree.getProof(1, wallets[1].address, BigNumber.from(2));
        await expect(localDistributor.claim(1, wallets[1].address, 2, proof))
          .to.emit(localDistributor, "Claimed")
          .withArgs(1, wallets[1].address, 2);
      });

      it("claim index 3", async () => {
        const proof = tree.getProof(3, wallets[3].address, BigNumber.from(4));
        await expect(localDistributor.claim(3, wallets[3].address, 4, proof))
          .to.emit(localDistributor, "Claimed")
          .withArgs(3, wallets[3].address, 4);
      });

      it("gas", async () => {
        const proof = tree.getProof(3, wallets[3].address, BigNumber.from(4));
        const tx = await localDistributor.claim(
          3,
          wallets[3].address,
          4,
          proof
        );
        const receipt = await tx.wait();
        expect(receipt.gasUsed).to.equal(81906);
      });

      it("gas second down about 15k", async () => {
        await localDistributor.claim(
          0,
          wallets[0].address,
          1,
          tree.getProof(0, wallets[0].address, BigNumber.from(1))
        );
        const tx = await localDistributor.claim(
          1,
          wallets[1].address,
          2,
          tree.getProof(1, wallets[1].address, BigNumber.from(2))
        );
        const receipt = await tx.wait();
        expect(receipt.gasUsed).to.equal(66896);
      });
    });

    describe("realistic size tree", () => {
      let localDistributor: Contract;
      let tree: BalanceTree;
      const NUM_LEAVES = 100_000;
      const NUM_SAMPLES = 25;
      const elements: { account: string; amount: BigNumber }[] = [];
      for (let i = 0; i < NUM_LEAVES; i++) {
        const node = { account: wallet0.address, amount: BigNumber.from(100) };
        elements.push(node);
      }
      tree = new BalanceTree(elements);

      it("proof verification works", () => {
        const root = Buffer.from(tree.getHexRoot().slice(2), "hex");
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree
            .getProof(i, wallet0.address, BigNumber.from(100))
            .map((el) => Buffer.from(el.slice(2), "hex"));
          const validProof = BalanceTree.verifyProof(
            i,
            wallet0.address,
            BigNumber.from(100),
            proof,
            root
          );
          expect(validProof).to.be.true;
        }
      });

      beforeEach("deploy", async () => {
        localDistributor = await Distributor.deploy(
          token.address,
          tree.getHexRoot()
        );
        await localDistributor.deployed();
        await token.setBalance(localDistributor.address, constants.MaxUint256);
      });

      it("gas", async () => {
        const proof = tree.getProof(
          50000,
          wallet0.address,
          BigNumber.from(100)
        );
        const tx = await localDistributor.claim(
          50000,
          wallet0.address,
          100,
          proof
        );
        const receipt = await tx.wait();
        expect(receipt.gasUsed).to.equal(93841);
      });
      it("gas deeper node", async () => {
        const proof = tree.getProof(
          90000,
          wallet0.address,
          BigNumber.from(100)
        );
        const tx = await localDistributor.claim(
          90000,
          wallet0.address,
          100,
          proof
        );
        const receipt = await tx.wait();
        expect(receipt.gasUsed).to.equal(93777);
      });
      it("gas average random distribution", async () => {
        let total: BigNumber = BigNumber.from(0);
        let count: number = 0;
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100));
          const tx = await localDistributor.claim(
            i,
            wallet0.address,
            100,
            proof
          );
          const receipt = await tx.wait();
          total = total.add(receipt.gasUsed);
          count++;
        }
        const average = total.div(count);
        expect(average).to.equal(79247);
      });
      // this is what we gas golfed by packing the bitmap
      it("gas average first 25", async () => {
        let total: BigNumber = BigNumber.from(0);
        let count: number = 0;
        for (let i = 0; i < 25; i++) {
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100));
          const tx = await localDistributor.claim(
            i,
            wallet0.address,
            100,
            proof
          );
          const receipt = await tx.wait();
          total = total.add(receipt.gasUsed);
          count++;
        }
        const average = total.div(count);
        expect(average).to.equal(65015);
      });

      it("no double claims in random distribution", async () => {
        for (
          let i = 0;
          i < 25;
          i += Math.floor(Math.random() * (NUM_LEAVES / NUM_SAMPLES))
        ) {
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100));
          await localDistributor.claim(i, wallet0.address, 100, proof);
          await expect(
            localDistributor.claim(i, wallet0.address, 100, proof)
          ).to.be.revertedWith("MerkleDistributor: Drop already claimed.");
        }
      });
    });
  });

  describe("parseBalanceMap", () => {
    let localDistributor: Contract;
    let claims: {
      [account: string]: {
        index: number;
        amount: string;
        proof: string[];
      };
    };
    beforeEach("deploy", async () => {
      const { claims: innerClaims, merkleRoot, tokenTotal } = parseBalanceMap({
        [wallet0.address]: 200,
        [wallet1.address]: 300,
        [wallets[2].address]: 250,
      });
      expect(tokenTotal).to.equal("0x02ee"); // 750
      claims = innerClaims;
      localDistributor = await Distributor.deploy(token.address, merkleRoot);
      await localDistributor.deployed();
      await token.setBalance(localDistributor.address, tokenTotal);
    });

    it("check the proofs is as expected", () => {
      expect(claims).to.deep.equal({
        [wallet0.address]: {
          index: 0,
          amount: "0xc8",
          proof: [
            "0x2a411ed78501edb696adca9e41e78d8256b61cfac45612fa0434d7cf87d916c6",
          ],
        },
        [wallet1.address]: {
          index: 1,
          amount: "0x012c",
          proof: [
            "0xbfeb956a3b705056020a3b64c540bff700c0f6c96c55c0a5fcab57124cb36f7b",
            "0xd31de46890d4a77baeebddbd77bf73b5c626397b73ee8c69b51efe4c9a5a72fa",
          ],
        },
        [wallets[2].address]: {
          index: 2,
          amount: "0xfa",
          proof: [
            "0xceaacce7533111e902cc548e961d77b23a4d8cd073c6b68ccf55c62bd47fc36b",
            "0xd31de46890d4a77baeebddbd77bf73b5c626397b73ee8c69b51efe4c9a5a72fa",
          ],
        },
      });
    });

    it("all claims work exactly once", async () => {
      for (let account in claims) {
        const claim = claims[account];
        await expect(
          localDistributor.claim(
            claim.index,
            account,
            claim.amount,
            claim.proof
          )
        )
          .to.emit(localDistributor, "Claimed")
          .withArgs(claim.index, account, claim.amount);
        await expect(
          localDistributor.claim(
            claim.index,
            account,
            claim.amount,
            claim.proof
          )
        ).to.be.revertedWith("MerkleDistributor: Drop already claimed.");
      }
      expect(await token.balanceOf(localDistributor.address)).to.equal(0);
    });
  });
});
