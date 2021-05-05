const { ethers, network } = require("hardhat");
const { provider, constants, BigNumber, getContractAt, utils } = ethers;

const hegicWritePoolABI = require("../../constants/abis/hegicWritePool.json");
const charmTokenABI = require("../../constants/abis/charmToken.json");
const primitiveLiquidityABI = require("../../constants/abis/primitiveLiquidity.json");
const opynControllerABI = require("../../constants/abis/opynController.json");
const opynTokenABI = require("../../constants/abis/opynToken.json");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const WBTC_ADDRESS = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";

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
  let charmOptionFactory = await getContractAt("ICharmOptionFactory", addr);

  async function getUser(event) {
    if (event["args"]["value"].gt(min)) {
      return event["args"]["to"].toString();
    }
  }

  var optionWriters = [];

  for (i = 0; i < (await charmOptionFactory.numMarkets()); i++) {
    var market = await getContractAt(
      "ICharmOptionMarket",
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

async function getOpynWriters(
  factoryAddress,
  controllerAddress,
  expiryIndex,
  minV1,
  minV2
) {
  var optionWriters = [];

  //V1 Writers

  let opynOptionFactory = await getContractAt(
    "IOpynOptionFactory",
    factoryAddress
  );

  async function getUserV1(event) {
    if (event["args"]["amount"].gt(minV1)) {
      return event["args"]["payer"].toString();
    }
  }

  for (
    i = expiryIndex;
    i < (await opynOptionFactory.getNumberOfOptionsContracts());
    i++
  ) {
    var token = await getContractAt(
      opynTokenABI,
      await opynOptionFactory.optionsContracts(i)
    );

    let filter = token.filters.ERC20CollateralAdded(null, null, null);
    optionWriters = optionWriters.concat(
      Array.from(
        await Promise.all((await token.queryFilter(filter)).map(getUserV1))
      )
    );
  }

  //V2 Writers

  let opynController = await getContractAt(
    opynControllerABI,
    controllerAddress
  );

  async function getUser(event) {
    // var token = await getContractAt(
    //   "IOpynOptionToken",
    //   await event["args"]["token"]
    // );
    //
    //
    // if (event["args"]["amount"].gt(await token.collateralAsset() === WBTC_ADDRESS ? minV2 : minV2.div(BigNumber.from("10").pow(BigNumber.from("2"))))) {
    //   return event["args"]["payer"].toString();
    // }

    if (event["args"]["amount"].gt(minV2)) {
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

module.exports.getHegicWriters = getHegicWriters;
module.exports.getCharmWriters = getCharmWriters;
module.exports.getPrimitiveWriters = getPrimitiveWriters;
module.exports.getOpynWriters = getOpynWriters;
