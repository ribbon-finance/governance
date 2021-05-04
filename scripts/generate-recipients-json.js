require("dotenv").config();
const { Command } = require("commander");
const { ethers, network } = require("hardhat");
const { provider, constants, BigNumber, getContractAt, utils } = ethers;

const { AIRDROP_PARAMS } = require("../params");

const hegicWritePoolABI = require("../constants/abis/hegicWritePool.json");
const charmTokenABI = require("../constants/abis/charmToken.json");
const primitiveLiquidityABI = require("../constants/abis/primitiveLiquidity.json");
const opynControllerABI = require("../constants/abis/opynController.json");

const program = new Command();

program
  .requiredOption(
    "-b, --block <blocknum>",
    "block number to use for extracting airdrop recipients"
  )
  .requiredOption(
    "-f, --file <file>",
    "json file to load addresses -> balances into"
  );

program.parse(process.argv);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ribbon
// base
// prorated
// external
// hegic
// opyn
// primitive
// charm

async function getHegicWriters(writeAddr, stakingAddr, min) {
  let writeContract = await getContractAt(hegicWritePoolABI, writeAddr);

  let stakingContract = await getContractAt("IStakingRewards", stakingAddr);

  async function getUser(event) {
    var providerAccount = event["args"]["account"].toString();
    var providerBalance = BigNumber.from(
      await writeContract.balanceOf(providerAccount)
    );
    if (providerBalance.gt(min)) {
      return providerAccount;
    }
    providerBalance = providerBalance.add(
      BigNumber.from(await stakingContract.balanceOf(providerAccount))
    );
    if (providerBalance.gt(min)) {
      return providerAccount;
    }
  }

  let filter = writeContract.filters.Provide(null, null, null);
  let providerAccounts = await Promise.all(
    (await writeContract.queryFilter(filter)).map(getUser)
  );
  return Array.from(providerAccounts);
}

async function getCharmWriters(addr, min) {
  let charmOptionFactory = await getContractAt("IOptionFactory", addr);

  async function getUser(event) {
    if (event["args"]["value"].gt(min)) {
      return event["args"]["to"].toString();
    }
  }

  var optionWriters = [];

  for (i = 0; i < (await charmOptionFactory.numMarkets()); i++) {
    var market = await getContractAt(
      "IOptionMarket",
      await charmOptionFactory.markets(i)
    );

    for (j = 0; j < (await market.numStrikes()); j++) {
      var token = await getContractAt(
        charmTokenABI,
        await market.shortTokens(j)
      );

      let filter = token.filters.Transfer(ZERO_ADDRESS, null, null);
      optionWriters = optionWriters.concat(
        Array.from(
          await Promise.all((await token.queryFilter(filter)).map(getUser))
        )
      );
    }
  }

  return [...new Set(optionWriters)];
}

async function getPrimitiveWriters(
  sushiConnectorAddr,
  uniConnectorAddr,
  primitiveLiquidityAddr,
  routers,
  min,
  block
) {
  var optionWriters = [];

  //Before rearchitecture LPs

  async function getUserConnector(tx) {
    let receipt = await provider.getTransactionReceipt(tx["hash"]);
    let logs = receipt["logs"];

    if (logs.length == 0) {
      return;
    }

    let mintLog = logs[logs.length - 1];

    if (routers.includes(utils.hexStripZeros(mintLog["topics"][1]))) {
      return receipt["from"];
    }
  }

  let etherscanProvider = new ethers.providers.EtherscanProvider();

  optionWriters = optionWriters.concat(
    Array.from(
      await Promise.all(
        (await etherscanProvider.getHistory(sushiConnectorAddr, 0, block)).map(
          getUserConnector
        )
      )
    )
  );
  optionWriters = optionWriters.concat(
    Array.from(
      await Promise.all(
        (await etherscanProvider.getHistory(uniConnectorAddr, 0, block)).map(
          getUserConnector
        )
      )
    )
  );

  //After rearchitecture LPs

  let primitiveLiquidity = await getContractAt(
    primitiveLiquidityABI,
    primitiveLiquidityAddr
  );

  async function getUser(event) {
    if (event["args"]["sum"].gt(min)) {
      return event["args"]["from"].toString();
    }
  }

  let filter = primitiveLiquidity.filters.AddLiquidity(null, null, null);
  optionWriters = optionWriters.concat(
    Array.from(
      await Promise.all(
        (await primitiveLiquidity.queryFilter(filter)).map(getUser)
      )
    )
  );

  return [...new Set(optionWriters)];
}

async function getOpynWriters(addr, min) {
  var optionWriters = [];

  //V1 Writers

  //ADD V1 METHODOLOGY

  //V2 Writers

  let opynController = await getContractAt(opynControllerABI, addr);

  async function getUser(event) {
    if (event["args"]["amount"].gt(min)) {
      return event["args"]["to"].toString();
    }
  }

  let filter = opynController.filters.ShortOtokenMinted(
    null,
    null,
    null,
    null,
    null
  );
  optionWriters = optionWriters.concat(
    Array.from(
      await Promise.all((await opynController.queryFilter(filter)).map(getUser))
    )
  );
  return [...new Set(optionWriters)];
}

async function main() {
  var endBlock = parseInt(program.opts().block);

  await network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.TEST_URI,
          blockNumber: endBlock,
        },
      },
    ],
  });

  // INTERNAL

  // strangle users

  // theta vault users

  // EXTERNAL

  // hegic writers
  let writeETHAddress = "0x878f15ffc8b894a1ba7647c7176e4c01f74e140b";
  let writeETHStakingAddress = "0x8FcAEf0dBf40D36e5397aE1979c9075Bf34C180e";
  let writeWBTCAddress = "0x20dd9e22d22dd0a6ef74a520cb08303b5fad5de7";
  let writeWBTCStakingAddress = "0x493134A9eAbc8D2b5e08C5AB08e9D413fb4D1a55";
  /* threshold amount for those who techincally hold writeETH / writeWBTC but it
  is dust left over from innacurate withdrawals, which is problem w UI */
  let HEGIC_ETH_MIN = BigNumber.from("20").mul(
    BigNumber.from("10").pow(BigNumber.from("18"))
  );
  let HEGIC_WBTC_MIN = BigNumber.from("1").mul(
    BigNumber.from("10").pow(BigNumber.from("18"))
  );

  console.log(`Pulling Hegic Writers...`);
  let hegicWriters = [
    ...new Set(
      (
        await getHegicWriters(
          writeETHAddress,
          writeETHStakingAddress,
          HEGIC_ETH_MIN
        )
      ).concat(
        await getHegicWriters(
          writeWBTCAddress,
          writeWBTCStakingAddress,
          HEGIC_WBTC_MIN
        )
      )
    ),
  ];
  console.log(`Num Hegic Writers: ${hegicWriters.length}`);

  // charm writers
  let charmOptionFactoryAddress = "0xCDFE169dF3D64E2e43D88794A21048A52C742F2B";
  //CHANGE
  let CHARM_MIN = BigNumber.from("0").mul(
    BigNumber.from("10").pow(BigNumber.from("18"))
  );

  console.log(`Pulling Charm Writers...`);
  let charmWriters = await getCharmWriters(
    charmOptionFactoryAddress,
    CHARM_MIN
  );
  console.log(`Num Charm Writers: ${charmWriters.length}`);

  // primitive writers
  let primitiveLiquidityAddress = "0x996Eeff28277FD17738913e573D1c452b4377A16";
  let sushiConnectorAddress = "0x9Daec8D56CDCBDE72abe65F4a5daF8cc0A5bF2f9";
  let uniConnectorAddress = "0x66fD5619a2a12dB3469e5A1bC5634f981e676c75";
  let routers = [
    "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f",
    "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
  ];
  //CHANGE
  let PRIMITIVE_MIN = BigNumber.from("0").mul(
    BigNumber.from("10").pow(BigNumber.from("18"))
  );

  console.log(`Pulling Primitive Writers...`);
  let primitiveWriters = await getPrimitiveWriters(
    sushiConnectorAddress,
    uniConnectorAddress,
    primitiveLiquidityAddress,
    routers,
    PRIMITIVE_MIN,
    endBlock
  );
  console.log(`Num Primitive Writers: ${primitiveWriters.length}`);

  // opyn writers
  let opynController = "0x4ccc2339F87F6c59c6893E1A678c2266cA58dC72";
  //CHANGE
  let OPYN_MIN = BigNumber.from("2").mul(
    BigNumber.from("10").pow(BigNumber.from("6"))
  );

  console.log(`Pulling Opyn Writers...`);
  let opynWriters = await getOpynWriters(opynController, OPYN_MIN);
  console.log(`Num Opyn Writers: ${opynWriters.length}`);

  console.log("Finished data extraction!");
  console.log(
    `Wrote airdrop addresses -> balances into ${program.opts().file}`
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
