require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-truffle5");
require("dotenv").config();

process.env.TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

module.exports = {
  accounts: {
    mnemonic: process.env.TEST_MNEMONIC,
  },
  solidity: {
    version: "0.8.0",
    settings: {
      optimizer: {
        runs: 200,
        enabled: true,
      },
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.TEST_URI,
        gasLimit: 8e6,
        blockNumber: 12239391,
      },
    },
    kovan: {
      url: process.env.KOVAN_URI,
      accounts: {
        mnemonic: process.env.KOVAN_MNEMONIC
      }
      // accounts: [`0x${process.env.KOVAN_KEY}`,`0x${process.env.KOVAN_KEY2}`]
    }
  },
  mocha: {
    timeout: 200000,
  },
};
