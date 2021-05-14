var _ = require("lodash");
const { ethers, network } = require("hardhat");
const { provider, constants, BigNumber, getContractAt, utils } = ethers;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WBTC_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";

let chainlinkPrices = {
  // ETH
  "0x0000000000000000000000000000000000000000":
    "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  // USDC
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48":
    "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
  // WETH
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2":
    "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  // WBTC
  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599":
    "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  // UNI
  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984":
    "0x553303d460EE0afB37EdFf9bE42922D8FF63220e",
  // SNX
  "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F":
    "0xDC3EA94CD0AC27d9A86C180091e7f78C683d3699",
  // DPI
  "0x1494CA1F11D487c2bBe4543E90080AeBa4BA3C2b":
    "0xD2A593BF7594aCE1faD597adb697b5645d5edDB2",
  // YFI
  "0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e":
    "0xA027702dbb89fbd58938e4324ac03B58d812b0E1",
};

const ETHERSCAN_API_KEY = "CAVAMK1HU28SRBRFDQN4JFQMEWFAI9ZGF6";

async function getHegicWriters(writeAddr, stakingAddr, writeRatio, min) {
  let writeContract = await getContractAt("IHegic", writeAddr);

  let stakingContract = await getContractAt("IStakingRewards", stakingAddr);

  async function getUser(event) {
    var providerAccount = event["args"]["account"].toString();
    var providerBalance = BigNumber.from(
      await stakingContract.balanceOf(providerAccount)
    );

    let decimals = await writeContract.decimals();

    let chainlinkAssetPrice =
      chainlinkPrices[decimals == 18 ? ZERO_ADDRESS : WBTC_ADDRESS];

    let amountInUSD = Math.floor(
      assetToUSD(
        providerBalance.div(writeRatio).toString(),
        decimals,
        chainlinkAssetPrice
      )
    );

    if (BigNumber.from(amountInUSD.toString()).gt(min)) {
      return providerAccount;
    }

    providerBalance = providerBalance.add(
      BigNumber.from(await writeContract.balanceOf(providerAccount))
    );

    amountInUSD = Math.floor(
      assetToUSD(
        providerBalance.div(writeRatio).toString(),
        decimals,
        chainlinkAssetPrice
      )
    );

    if (BigNumber.from(amountInUSD.toString()).gt(min)) {
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

  let balances = {};

  async function getUser(event, decimals, price) {
    let user = event["args"]["to"].toString();
    let amountInUSD = assetToUSD(event["args"]["value"], decimals, price);

    if (balances[user] == undefined) {
      balances[user] = 0;
    }

    balances[user] = Math.floor(balances[user] + amountInUSD);
  }

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

      let collateral = await market.baseToken();
      let collateralContract = await getContractAt(
        "ERC20",
        collateral == ZERO_ADDRESS ? WETH_ADDRESS : collateral
      );

      let chainlinkAssetPrice = chainlinkPrices[collateral];
      let assetDecimals = await collateralContract.decimals();

      let filter = token.filters.Transfer(ZERO_ADDRESS, null, null);
      await Promise.all(
        (await token.queryFilter(filter)).map((e) =>
          getUser(e, assetDecimals, chainlinkAssetPrice)
        )
      );
    }
  }

  return _.flow([
    Object.entries,
    (arr) =>
      arr.filter(
        ([k, v]) => k != undefined && BigNumber.from(v.toString()).gt(min)
      ),
    Object.fromEntries,
  ])(balances);
}

async function getPrimitiveWriters(
  sushiConnectorAddr,
  uniConnectorAddr,
  primitiveLiquidityAddr,
  routers,
  rList,
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

    /*
      If the first parameter of the last log is the sushiswap / uniswap router addresse
      we know we have a Mint() log which means we have an LP Add Liquidity action
    */
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
    return event["args"]["from"].toString();
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
    .filter((k) => k != undefined && !rList.includes(k))
    .reduce((acc, curr) => ((acc[curr] = BigNumber.from("0")), acc), {});
}

async function getOpynWriters(
  factoryAddress,
  controllerAddress,
  expiryIndex,
  min
) {
  let balances = {};

  //V1 Writers

  let opynOptionFactory = await getContractAt(
    "IOpynOptionFactory",
    factoryAddress
  );

  async function getUserV1(event, decimals, price) {
    let user = event["args"]["payer"].toString();

    let amountInUSD = assetToUSD(event["args"]["amount"], decimals, price);

    if (balances[user] == undefined) {
      balances[user] = 0;
    }
    balances[user] = Math.floor(balances[user] + amountInUSD);
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

    let collateral = await token.collateral();
    let collateralContract = await getContractAt(
      "ERC20",
      collateral == ZERO_ADDRESS ? WETH_ADDRESS : collateral
    );

    let chainlinkAssetPrice = chainlinkPrices[collateral];
    let assetDecimals = await collateralContract.decimals();

    let filter = token.filters.ERC20CollateralAdded(null, null, null);
    await Promise.all(
      (await token.queryFilter(filter)).map((e) =>
        getUserV1(e, assetDecimals, chainlinkAssetPrice)
      )
    );
  }

  //V2 Writers

  let opynController = await getContractAt(
    "IOpynController",
    controllerAddress
  );

  async function getUser(event) {
    let user = event["args"]["to"].toString();

    var otoken = await getContractAt(
      "IOpynOptionTokenV2",
      event["args"]["otoken"]
    );

    let chainlinkAssetPrice = chainlinkPrices[await otoken.collateralAsset()];
    var assetDecimals = await otoken.decimals();

    let amountInUSD = assetToUSD(
      event["args"]["amount"],
      assetDecimals,
      chainlinkAssetPrice
    );

    if (balances[user] == undefined) {
      balances[user] = 0;
    }
    balances[user] = Math.floor(balances[user] + amountInUSD);
  }

  let filter = opynController.filters.ShortOtokenMinted(
    null,
    null,
    null,
    null,
    null
  );

  await Promise.all((await opynController.queryFilter(filter)).map(getUser));

  return _.flow([
    Object.entries,
    (arr) =>
      arr.filter(
        ([k, v]) => k != undefined && BigNumber.from(v.toString()).gt(min)
      ),
    Object.fromEntries,
  ])(balances);
}

async function getRibbonStrangleUsers(
  ribbonHegicOptionsAddress,
  ribbonStrangleContractsAddresses,
  min
) {
  let ribbonHegicOptionsContract = await getContractAt(
    "IRibbonStrangleHegic",
    ribbonHegicOptionsAddress
  );

  let balances = {};

  async function getUser(event) {
    let receipt = await provider.getTransactionReceipt(
      event["transactionHash"]
    );
    let user = receipt["from"].toString();

    let depositInUSD = assetToUSD(
      event["args"]["totalFee"],
      18,
      chainlinkPrices[ZERO_ADDRESS]
    );

    if (balances[user] == undefined) {
      balances[user] = 0;
    }
    balances[user] = Math.floor(balances[user] + depositInUSD);
  }

  let filter = ribbonHegicOptionsContract.filters.Create(
    null,
    ribbonStrangleContractsAddresses,
    null,
    null
  );

  await Promise.all(
    (await ribbonHegicOptionsContract.queryFilter(filter)).map(getUser)
  );

  return _.flow([
    Object.entries,
    (arr) =>
      arr.filter(
        ([k, v]) => k != undefined && BigNumber.from(v.toString()).gt(min)
      ),
    Object.fromEntries,
  ])(balances);
}

async function getRibbonThetaVaultUsers(ribbonThetaVaultAddresses, min) {
  let totalDeposits = {};
  let totalBalance = {};
  let seenAddresses = {};
  const addresses = [];

  async function getUserDeposits(event, decimals, price) {
    let user = event["args"]["account"];

    let amountInUSD = assetToUSD(event["args"]["amount"], decimals, price);

    if (totalDeposits[user] === undefined) {
      totalDeposits[user] = 0;
    }
    totalDeposits[user] = Math.floor(totalDeposits[user] + amountInUSD);
  }

  async function getUserBalance(vaultAddress, user, decimals, price) {
    const key = vaultAddress + "-" + user;
    // don't double count balances
    if (seenAddresses[key] !== undefined) {
      return;
    }
    seenAddresses[key] = true;
    addresses.push(key);

    let ribbonThetaVaultContract = await getContractAt(
      "IRibbonThetaVault",
      vaultAddress
    );
    const balance = await ribbonThetaVaultContract.accountVaultBalance(user);

    let amountInUSD = assetToUSD(balance, decimals, price);

    if (totalBalance[user] == undefined) {
      totalBalance[user] = 0;
    }
    totalBalance[user] = Math.floor(totalBalance[user] + amountInUSD);
  }

  for (const thetaVaultAddress of ribbonThetaVaultAddresses) {
    let ribbonThetaVaultContract = await getContractAt(
      "IRibbonThetaVault",
      thetaVaultAddress
    );

    let chainlinkAssetPrice =
      chainlinkPrices[await ribbonThetaVaultContract.asset()];

    let assetDecimals = await ribbonThetaVaultContract.decimals();

    let filter = ribbonThetaVaultContract.filters.Deposit(null, null, null);

    await Promise.all(
      (await ribbonThetaVaultContract.queryFilter(filter)).map(async (e) => {
        let user = e["args"]["account"];

        await getUserDeposits(e, assetDecimals, chainlinkAssetPrice);

        await getUserBalance(
          thetaVaultAddress,
          user,
          assetDecimals,
          chainlinkAssetPrice
        );
      })
    );
  }

  totalDeposits = _.flow([
    Object.entries,
    (arr) =>
      arr.filter(
        ([k, v]) => k != undefined && BigNumber.from(v.toString()).gt(min)
      ),
    Object.fromEntries,
  ])(totalDeposits);

  const originalLen = addresses.length;
  const uniqLen = addresses.filter(function onlyUnique(value, index, self) {
    return self.indexOf(value) === index;
  }).length;
  if (originalLen !== uniqLen) {
    throw new Error("Double counting error for balance");
  }

  return _.mapValues(totalDeposits, function (v, k) {
    return {
      totalDeposits: BigNumber.from(totalDeposits[k].toString()),
      totalBalance: BigNumber.from(totalBalance[k].toString()),
    };
  });
}

async function preloadChainlinkPrices() {
  await _.mapValues(chainlinkPrices, async function (v, k) {
    let chainlinkContract = await getContractAt(
      "IChainlink",
      chainlinkPrices[k]
    );

    let LATEST_ORACLE_ANSWER = BigNumber.from(
      await chainlinkContract.latestAnswer()
    ).div(
      BigNumber.from("10").pow(
        BigNumber.from(await chainlinkContract.decimals())
      )
    );

    chainlinkPrices[k] = LATEST_ORACLE_ANSWER;
  });
}

function assetToUSD(amount, decimals, chainlinkPrice) {
  let newAmount = parseFloat(
    utils.formatUnits(BigNumber.from(amount.toString()), decimals).toString()
  );

  return parseInt(chainlinkPrice) * newAmount;
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
module.exports.preloadChainlinkPrices = preloadChainlinkPrices;
