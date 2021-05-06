var _ = require("lodash");
const { ethers, network } = require("hardhat");
const { provider, constants, BigNumber, getContractAt, utils } = ethers;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const WBTC_ADDRESS = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
const ETHERSCAN_API_KEY = "CAVAMK1HU28SRBRFDQN4JFQMEWFAI9ZGF6";

async function getHegicWriters(writeAddr, stakingAddr, min) {
  let writeContract = await getContractAt("IHegic", writeAddr);

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

  return [...new Set(providerAccounts)]
    .filter((k) => k != undefined)
    .reduce((acc, curr) => ((acc[curr] = BigNumber.from("0")), acc), {});
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
        "ICharmOptionToken",
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

  return [...new Set(optionWriters)]
    .filter((k) => k != undefined)
    .reduce((acc, curr) => ((acc[curr] = BigNumber.from("0")), acc), {});
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

  let etherscanProvider = new ethers.providers.EtherscanProvider(
    "homestead",
    ETHERSCAN_API_KEY
  );

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
    "IPrimitiveLiquidity",
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

  return [...new Set(optionWriters)]
    .filter((k) => k != undefined)
    .reduce((acc, curr) => ((acc[curr] = BigNumber.from("0")), acc), {});
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
      "IOpynOptionTokenV1",
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
    "IOpynController",
    controllerAddress
  );

  async function getUser(event) {
    // var token = await getContractAt(
    //   "IOpynOptionTokenV2",
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
  return [...new Set(optionWriters)]
    .filter((k) => k != undefined)
    .reduce((acc, curr) => ((acc[curr] = BigNumber.from("0")), acc), {});
}

async function getRibbonStrangleUsers(addr, min) {
  let ribbonStrangleContract = await getContractAt("IRibbonStrangle", addr);

  async function getUser(event) {
    if (event["args"]["amount"].gt(min)) {
      return event["args"]["account"].toString();
    }
  }

  let filter = ribbonStrangleContract.filters.PositionCreated(
    null,
    null,
    null,
    null,
    null
  );
  let userAccounts = await Promise.all(
    (await ribbonStrangleContract.queryFilter(filter)).map(getUser)
  );
  return [...new Set(userAccounts)]
    .filter((k) => k != undefined)
    .reduce((acc, curr) => ((acc[curr] = BigNumber.from("0")), acc), {});
}

async function getRibbonThetaVaultUsers(ribbonVaultAddress, chainlinkAddress) {
  let ribbonThetaVaultContract = await getContractAt(
    "IRibbonThetaVault",
    ribbonVaultAddress
  );
  let chainlinkContract = await getContractAt("IChainlink", chainlinkAddress);

  const LATEST_ORACLE_ANSWER = BigNumber.from(
    await chainlinkContract.latestAnswer()
  ).div(
    BigNumber.from("10").pow(BigNumber.from(await chainlinkContract.decimals()))
  );
  const ASSET_DECIMALS = await ribbonThetaVaultContract.decimals();

  let balances = {};

  async function getUser(event) {
    let user = event["args"]["account"];
    let deposit = parseFloat(
      utils
        .formatUnits(
          BigNumber.from(event["args"]["amount"].toString()),
          ASSET_DECIMALS
        )
        .toString()
    );
    let depositInUSD = parseInt(LATEST_ORACLE_ANSWER) * deposit;
    if (balances[user] == undefined) {
      balances[user] = 0;
    }
    balances[user] = Math.floor(balances[user] + depositInUSD);
  }

  let filter = ribbonThetaVaultContract.filters.Deposit(null, null, null);
  let userAccounts = await Promise.all(
    (await ribbonThetaVaultContract.queryFilter(filter)).map(getUser)
  );

  return _.mapValues(balances, function (v, k) {
    return BigNumber.from(balances[k].toString());
  });
}

function mergeObjects(...objs) {
  return objs.reduce((a, b) => {
    for (let k in b) {
      if (b.hasOwnProperty(k)) a[k] = (a[k] || BigNumber.from(0)).add(b[k]);
    }
    return a;
  }, {});
}

module.exports.getHegicWriters = getHegicWriters;
module.exports.getCharmWriters = getCharmWriters;
module.exports.getPrimitiveWriters = getPrimitiveWriters;
module.exports.getOpynWriters = getOpynWriters;
module.exports.getRibbonStrangleUsers = getRibbonStrangleUsers;
module.exports.getRibbonThetaVaultUsers = getRibbonThetaVaultUsers;
module.exports.mergeObjects = mergeObjects;
