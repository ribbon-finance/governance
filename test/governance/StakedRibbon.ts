/**
 * Credit to sRBNswap
 */
import chai, { expect } from "chai";
import { Contract, constants, utils, Wallet } from "ethers";
import { solidity } from "ethereum-waffle";
import { ecsign } from "ethereumjs-util";

import { governanceFixture } from "./fixtures";
import { expandTo18Decimals, mineBlock } from "./utils";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Provider } from "@ethersproject/abstract-provider";
import { parseEther } from "@ethersproject/units";

chai.use(solidity);

const DOMAIN_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes(
    "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
  )
);

const PERMIT_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes(
    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
  )
);

describe("StakedRibbon", () => {
  let sRBN: Contract;
  let minter: SignerWithAddress;
  let wallet: Wallet, other0: SignerWithAddress, other1: SignerWithAddress;
  let provider: Provider;

  beforeEach(async () => {
    wallet = await ethers.Wallet.fromMnemonic(
      "test test test test test test test test test test test junk"
    );
    [, other0, other1] = await ethers.getSigners();
    const fixture = await governanceFixture();
    sRBN = fixture.sRBN;
    provider = ethers.provider;
    minter = fixture.minter;

    await sRBN.mint(wallet.address, parseEther("100"), {
      from: minter.address,
    });
  });

  it("permit", async () => {
    const chainId = 31337;

    const domainSeparator = utils.keccak256(
      utils.defaultAbiCoder.encode(
        ["bytes32", "bytes32", "uint256", "address"],
        [
          DOMAIN_TYPEHASH,
          utils.keccak256(utils.toUtf8Bytes("Staked Ribbon")),
          chainId,
          sRBN.address,
        ]
      )
    );

    const owner = wallet.address;
    const spender = other0.address;
    const value = 123;
    const nonce = await sRBN.nonces(owner);
    const deadline = constants.MaxUint256;
    const digest = utils.keccak256(
      utils.solidityPack(
        ["bytes1", "bytes1", "bytes32", "bytes32"],
        [
          "0x19",
          "0x01",
          domainSeparator,
          utils.keccak256(
            utils.defaultAbiCoder.encode(
              [
                "bytes32",
                "address",
                "address",
                "uint256",
                "uint256",
                "uint256",
              ],
              [PERMIT_TYPEHASH, owner, spender, value, nonce, deadline]
            )
          ),
        ]
      )
    );

    const { v, r, s } = ecsign(
      Buffer.from(digest.slice(2), "hex"),
      Buffer.from(wallet.privateKey.slice(2), "hex")
    );

    await sRBN.permit(
      owner,
      spender,
      value,
      deadline,
      v,
      utils.hexlify(r),
      utils.hexlify(s)
    );
    expect(await sRBN.allowance(owner, spender)).to.eq(value);
    expect(await sRBN.nonces(owner)).to.eq(1);

    await sRBN.connect(other0).transferFrom(owner, spender, value);
  });

  it("nested delegation", async () => {
    await sRBN.transfer(other0.address, expandTo18Decimals(1));
    await sRBN.transfer(other1.address, expandTo18Decimals(2));

    let currectVotes0 = await sRBN.getCurrentVotes(other0.address);
    let currectVotes1 = await sRBN.getCurrentVotes(other1.address);
    expect(currectVotes0).to.be.eq(0);
    expect(currectVotes1).to.be.eq(0);

    await sRBN.connect(other0).delegate(other1.address);
    currectVotes1 = await sRBN.getCurrentVotes(other1.address);
    expect(currectVotes1).to.be.eq(expandTo18Decimals(1));

    await sRBN.connect(other1).delegate(other1.address);
    currectVotes1 = await sRBN.getCurrentVotes(other1.address);
    expect(currectVotes1).to.be.eq(
      expandTo18Decimals(1).add(expandTo18Decimals(2))
    );

    await sRBN.connect(other1).delegate(wallet.address);
    currectVotes1 = await sRBN.getCurrentVotes(other1.address);
    expect(currectVotes1).to.be.eq(expandTo18Decimals(1));
  });

  it("mints", async () => {
    const StakedRibbon = await ethers.getContractFactory("StakedRibbon");
    const sRBN = await StakedRibbon.deploy(wallet.address);

    await expect(
      sRBN.connect(other1).mint(other1.address, 1)
    ).to.be.revertedWith("sRBN::mint: only the minter can mint");
    await expect(
      sRBN.mint("0x0000000000000000000000000000000000000000", 1)
    ).to.be.revertedWith("sRBN::mint: cannot transfer to the zero address");
  });
});
