const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = ethers;

const { TOKEN_PARAMS } = require("../params");

describe("Ribbon Token contract", function () {
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
      TOKEN_PARAMS.OWNER
    );

    await ribbonToken.deployed();

    // Allow impersonation of new account
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [TOKEN_PARAMS.OWNER],
    });
    const signer = await ethers.provider.getSigner(await ribbonToken.owner());
    let token = await ethers.getContractAt("RibbonToken", ribbonToken.address);
    withSigner = await token.connect(signer);
  });

  // Test initial setup
  describe("Deployment", function () {
    it("Should mint the total supply", async function () {
      expect(await ribbonToken.totalSupply()).to.equal(TOKEN_PARAMS.SUPPLY);
    });

    it("Should mint the total supply of tokens to the new owner", async function () {
      const ownerBalance = await ribbonToken.balanceOf(TOKEN_PARAMS.OWNER);
      expect(await ribbonToken.totalSupply()).to.equal(ownerBalance);
    });

    it("Should set the new owner", async function () {
      expect(await ribbonToken.owner()).to.equal(TOKEN_PARAMS.OWNER);
    });

    it("Should transfer ownership away from contract deployer", async function () {
      expect(await ribbonToken.owner()).to.not.equal(owner.address);
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

  // Test pause functionality
  describe("Pause", function () {
    it("Should be possible by the owner", async function () {
      await withSigner.pause();
      await expect(await withSigner.paused()).to.equal(true);
    });

    it("Should unpause when unpaused by owner", async function () {
      await withSigner.pause();
      await withSigner.unpause();
      await expect(await withSigner.paused()).to.equal(false);
    });

    it("Should revert pause attempts by non-owner", async function () {
      await expect(ribbonToken.pause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("Should revert transfers when paused", async function () {
      await withSigner.pause();
      await expect(withSigner.transfer(addr1.address, 50)).to.be.revertedWith(
        "ERC20Pausable: token transfer while paused"
      );
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
        await ribbonToken.owner()
      );

      // Try to send 1 token from addr1 (0 tokens) to owner (1000 tokens).
      // `require` will evaluate false and revert the transaction.
      await expect(
        ribbonToken.connect(addr1).transfer(owner.address, 1)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      // Owner balance shouldn't have changed.
      expect(await ribbonToken.balanceOf(await ribbonToken.owner())).to.equal(
        initialOwnerBalance
      );
    });

    it("Should update balances after transfers", async function () {
      const initialOwnerBalance = await ribbonToken.balanceOf(
        await ribbonToken.owner()
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
        await ribbonToken.owner()
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
