const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = ethers;
const { formatBytes32String } = ethers.utils;

const { TOKEN_PARAMS } = require("../params");

describe("RibbonToken contract", function () {
  let RibbonToken;
  let ribbonToken;
  let owner;
  let addr1;
  let addr2;
  let addrs;
  let withSigner;

  beforeEach(async function () {
    // Get the ContractFactory and Signers here.
    RibbonToken = await ethers.getContractFactory("RibbonToken");
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    ribbonToken = await RibbonToken.deploy(
      TOKEN_PARAMS.NAME,
      TOKEN_PARAMS.SYMBOL,
      TOKEN_PARAMS.SUPPLY,
      TOKEN_PARAMS.BENIFICIARY
    );

    await ribbonToken.deployed();

    // Allow impersonation of new account
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [TOKEN_PARAMS.BENIFICIARY],
    });
    const signer = await ethers.provider.getSigner(TOKEN_PARAMS.BENIFICIARY);
    let token = await ethers.getContractAt("RibbonToken", ribbonToken.address);
    withSigner = await token.connect(signer);
  });

  // Test initial setup
  describe("Deployment", function () {
    it("Should mint the total supply", async function () {
      expect(await ribbonToken.totalSupply()).to.equal(TOKEN_PARAMS.SUPPLY);
    });

    it("Should mint the total supply of tokens to the new benificiary", async function () {
      const ownerBalance = await ribbonToken.balanceOf(
        TOKEN_PARAMS.BENIFICIARY
      );
      expect(await ribbonToken.totalSupply()).to.equal(ownerBalance);
    });

    it("Should grant beneficiary has minting rights", async function () {
      await expect(
        await withSigner.hasRole(
          await ribbonToken.MINTER_ROLE(),
          TOKEN_PARAMS.BENIFICIARY
        )
      ).to.equal(true);
    });

    it("Should not grant non-beneficiary any minting rights", async function () {
      await expect(
        await withSigner.hasRole(await ribbonToken.MINTER_ROLE(), addr1.address)
      ).to.equal(false);
    });
  });

  // Test mint capabilities
  describe("Mintability", function () {
    it("Should allow the benificiary to mint", async function () {
      await expect(await withSigner.mint(addr1.address, 50)).to.emit(
        ribbonToken,
        "Transfer"
      );
    });

    it("Should revert mint attempts by non-minter", async function () {
      await expect(ribbonToken.mint(addr1.address, 50)).to.be.revertedWith(
        "RibbonToken: only minter"
      );
    });

    it("Should revert mint attempts by minter after role renounced", async function () {
      await withSigner.renounceRole(
        await ribbonToken.MINTER_ROLE(),
        TOKEN_PARAMS.BENIFICIARY
      );
      await expect(withSigner.mint(addr1.address, 50)).to.be.revertedWith(
        "RibbonToken: only minter"
      );
    });
  });

  // Test token parameter
  describe("Token Parameters", function () {
    it("Should have the correct decimals", async function () {
      expect(await ribbonToken.decimals()).to.equal(
        parseInt(TOKEN_PARAMS.DECIMALS)
      );
    });

    it("Should have the correct name", async function () {
      expect(await ribbonToken.name()).to.equal(TOKEN_PARAMS.NAME);
    });

    it("Should have the correct symbol", async function () {
      expect(await ribbonToken.symbol()).to.equal(TOKEN_PARAMS.SYMBOL);
    });
  });

  // Test arbitrary ribbon token transfer attempts
  describe("Transactions", function () {
    it("Should transfer tokens between accounts", async function () {
      // Transfer 50 tokens from owner to addr1
      await withSigner.transfer(addr1.address, 50);
      const addr1Balance = await ribbonToken.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(50);

      // Transfer 50 tokens from addr1 to addr2
      // We use .connect(signer) to send a transaction from another account
      await ribbonToken.connect(addr1).transfer(addr2.address, 50);
      const addr2Balance = await ribbonToken.balanceOf(addr2.address);
      expect(addr2Balance).to.equal(50);
    });

    it("Should fail if sender doesn’t have enough tokens", async function () {
      const initialOwnerBalance = await ribbonToken.balanceOf(
        TOKEN_PARAMS.BENIFICIARY
      );

      // Try to send 1 token from addr1 (0 tokens) to owner (1000 tokens).
      // `require` will evaluate false and revert the transaction.
      await expect(
        ribbonToken.connect(addr1).transfer(owner.address, 1)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      // Owner balance shouldn't have changed.
      expect(await ribbonToken.balanceOf(TOKEN_PARAMS.BENIFICIARY)).to.equal(
        initialOwnerBalance
      );
    });

    it("Should update balances after transfers", async function () {
      const initialOwnerBalance = await ribbonToken.balanceOf(
        TOKEN_PARAMS.BENIFICIARY
      );

      // Transfer 100 tokens from owner to addr1.
      const toTransfer1 = BigNumber.from("100")
        .mul(BigNumber.from("10").pow(BigNumber.from(TOKEN_PARAMS.DECIMALS)))
        .toString();
      await withSigner.transfer(addr1.address, toTransfer1);

      // Transfer another 50 tokens from owner to addr1.
      const toTransfer2 = BigNumber.from("50")
        .mul(BigNumber.from("10").pow(BigNumber.from(TOKEN_PARAMS.DECIMALS)))
        .toString();
      await withSigner.transfer(addr2.address, toTransfer2);

      const amountLost = BigNumber.from("150").mul(
        BigNumber.from("10").pow(BigNumber.from(TOKEN_PARAMS.DECIMALS))
      );

      // Check balances.
      const finalOwnerBalance = await ribbonToken.balanceOf(
        TOKEN_PARAMS.BENIFICIARY
      );
      expect(finalOwnerBalance.toString()).to.equal(
        initialOwnerBalance.sub(amountLost).toString()
      );

      const addr1Balance = await ribbonToken.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(toTransfer1);

      const addr2Balance = await ribbonToken.balanceOf(addr2.address);
      expect(addr2Balance).to.equal(toTransfer2);
    });
  });
});
