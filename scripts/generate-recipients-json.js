require("dotenv").config();
var _ = require("lodash");
const fs = require("fs");
const { Command } = require("commander");
const { ethers, network } = require("hardhat");
const { provider, constants, BigNumber, getContractAt, utils } = ethers;

const { AIRDROP_SCRIPT_PARAMS } = require("../params");

const program = new Command();

program
  .option(
    "-b, --block <blocknum>",
    "block number to use for extracting airdrop recipients",
    "12378107"
  )
  .option(
    "-f, --file <file>",
    "json file to load addresses -> balances into",
    "airdrop.json"
  );

program.parse(process.argv);

const {
  getHegicWriters,
  getCharmWriters,
  getPrimitiveWriters,
  getOpynWriters,
  getRibbonStrangleUsers,
  getRibbonThetaVaultUsers,
  mergeObjects,
} = require("./helpers/protocol-extractors");

// ribbon -> strangle + tv
// external -> hegic + opyn + primitive + charm

let writeETHAddress = "0x878f15ffc8b894a1ba7647c7176e4c01f74e140b";
let writeETHStakingAddress = "0x8FcAEf0dBf40D36e5397aE1979c9075Bf34C180e";
let writeWBTCAddress = "0x20dd9e22d22dd0a6ef74a520cb08303b5fad5de7";
let writeWBTCStakingAddress = "0x493134A9eAbc8D2b5e08C5AB08e9D413fb4D1a55";

let charmOptionFactoryAddress = "0xCDFE169dF3D64E2e43D88794A21048A52C742F2B";

let primitiveLiquidityAddress = "0x996Eeff28277FD17738913e573D1c452b4377A16";
let sushiConnectorAddress = "0x9Daec8D56CDCBDE72abe65F4a5daF8cc0A5bF2f9";
let uniConnectorAddress = "0x66fD5619a2a12dB3469e5A1bC5634f981e676c75";
let routers = [
  "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f",
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
];

let opynFactory = "0xcC5d905b9c2c8C9329Eb4e25dc086369D6C7777C";
let opynController = "0x4ccc2339F87F6c59c6893E1A678c2266cA58dC72";
// start index in otoken mappings where expiry is in 2021 (https://etherscan.io/address/0xcc5d905b9c2c8c9329eb4e25dc086369d6c7777c#readContract)
let opynExpiryIndex = 108;

let ribbonStrangleHegicContract = "0xEfC0eEAdC1132A12c9487d800112693bf49EcfA2";
let ribbonStrangleContracts = [
  "0xce797549a7025561aE60569F68419f016e97D8c5",
  "0x91C7F173b50A219cfbB76fD59B4D808A3FD65395",
  "0xE373F4c9e1dE975B3C0B7fc6C162a9E94620b960",
  "0x116ae12b84Fb37d073293698A42143759aff043B",
  "0xD13D279073DBDdeD368D822FAb8a59604f86CA51",
  "0x390Df0394ef2930Eae1E3a610202D644fc21127c",
  "0x5ED32Cce0EcBd7E6e538231d6A3dc28A699A1501",
  "0x4de07FF16297026AE23d9019383DA06250E539e8",
];

let ribbonEthCallThetaVaultAddress =
  "0x0fabaf48bbf864a3947bdd0ba9d764791a60467a";
let ribbonEthPutThetaVaultAddress =
  "0x16772a7f4a3ca291c21b8ace76f9332ddffbb5ef";
let ribbonBtcCallThetaVaultAddress =
  "0x8b5876f5B0Bf64056A89Aa7e97511644758c3E8c";
let ribbonBtcPutThetaVaultAddress = "";
let ribbonEthCallOracleAddress = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
let ribbonEthPutOracleAddress = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
let ribbonBtcCallOracleAddress = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
let ribbonBtcPutOracleAddress = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";

// MIN REQUIREMENT for option writing sizes

/* threshold amount for those who hold writeETH / writeWBTC */
let HEGIC_ETH_MIN = BigNumber.from("22").mul(
  BigNumber.from("10").pow(BigNumber.from("18"))
);
let HEGIC_WBTC_MIN = BigNumber.from("1").mul(
  BigNumber.from("10").pow(BigNumber.from("18"))
);
let CHARM_MIN = BigNumber.from("2").mul(
  BigNumber.from("10").pow(BigNumber.from("16"))
);
let PRIMITIVE_MIN = BigNumber.from("0").mul(
  BigNumber.from("10").pow(BigNumber.from("18"))
);
let OPYN_V1_MIN = BigNumber.from("0").mul(
  BigNumber.from("10").pow(BigNumber.from("6"))
);
let OPYN_V2_MIN = BigNumber.from("0").mul(
  BigNumber.from("10").pow(BigNumber.from("6"))
);
// (rn its 0.02 min eth)
let RIBBON_MIN = BigNumber.from("2").mul(
  BigNumber.from("10").pow(BigNumber.from("16"))
);
// 50 with no 0's because we are given usd value in map
let THETA_VAULT_MIN = BigNumber.from("50");

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

  // EXTERNAL

  var masterBalance = {};

  /*
    HEGIC
  */
  console.log(`\nPulling Hegic Writers...`);
  let hegicEthWriters = await getHegicWriters(
    writeETHAddress,
    writeETHStakingAddress,
    HEGIC_ETH_MIN
  );

  let hegicWBTCWriters = await getHegicWriters(
    writeWBTCAddress,
    writeWBTCStakingAddress,
    HEGIC_WBTC_MIN
  );

  masterBalance = mergeObjects(hegicEthWriters, hegicWBTCWriters);

  console.log(`Num Hegic Writers: ${Object.keys(masterBalance).length}\n`);

  /*
    CHARM
  */
  console.log(`Pulling Charm Writers...`);
  let charmWriters = await getCharmWriters(
    charmOptionFactoryAddress,
    CHARM_MIN
  );
  console.log(`Num Charm Writers: ${Object.keys(charmWriters).length}\n`);

  /*
    PRIMITIVE
  */
  console.log(`Pulling Primitive Writers...`);
  let primitiveWriters = await getPrimitiveWriters(
    sushiConnectorAddress,
    uniConnectorAddress,
    primitiveLiquidityAddress,
    routers,
    PRIMITIVE_MIN,
    endBlock
  );

  console.log(
    `Num Primitive Writers: ${Object.keys(primitiveWriters).length}\n`
  );

  /*
    OPYN
  */
  console.log(`Pulling Opyn Writers...`);
  let opynWriters = await getOpynWriters(
    opynFactory,
    opynController,
    opynExpiryIndex,
    OPYN_V1_MIN,
    OPYN_V2_MIN
  );
  console.log(`Num Opyn Writers: ${Object.keys(opynWriters).length}\n`);

  masterBalance = mergeObjects(
    masterBalance,
    charmWriters,
    primitiveWriters,
    opynWriters
  );
  masterBalance = _.mapValues(masterBalance, () =>
    AIRDROP_SCRIPT_PARAMS.EXTERNAL_PROTOCOLS_AMOUNT.div(
      BigNumber.from(Object.keys(masterBalance).length.toString())
    )
  );

  // INTERNAL

  /*
    RIBBON STRANGLE
  */
  console.log(`Pulling Ribbon Strangle Users...`);
  let ribbonStrangleUsers = await getRibbonStrangleUsers(
    ribbonStrangleHegicContract,
    ribbonStrangleContracts,
    RIBBON_MIN
  );

  console.log(
    `Num Ribbon Strangle Users: ${Object.keys(ribbonStrangleUsers).length}\n`
  );

  ribbonStrangleUsers = _.mapValues(ribbonStrangleUsers, () =>
    AIRDROP_SCRIPT_PARAMS.STRANGLE_AMOUNT.div(
      BigNumber.from(Object.keys(ribbonStrangleUsers).length.toString())
    )
  );

  /*
    RIBBON THETA VAULT
  */
  console.log(`Pulling Ribbon Theta Vault Users...`);
  let ribbonETHCALLThetaVaultUsers = await getRibbonThetaVaultUsers(
    ribbonEthCallThetaVaultAddress,
    ribbonEthCallOracleAddress,
    THETA_VAULT_MIN
  );
  let ribbonETHPUTThetaVaultUsers = await getRibbonThetaVaultUsers(
    ribbonEthPutThetaVaultAddress,
    ribbonEthPutOracleAddress,
    THETA_VAULT_MIN
  );
  let ribbonBTCCALLThetaVaultUsers = await getRibbonThetaVaultUsers(
    ribbonBtcCallThetaVaultAddress,
    ribbonBtcCallOracleAddress,
    THETA_VAULT_MIN
  );
  // let ribbonBTCPUTThetaVaultUsers = await getRibbonThetaVaultUsers(
  //   ribbonBtcPutThetaVaultAddress,
  //   ribbonBtcPutOracleAddress,
  //   ribbonBtcPutDecimals,
  //   THETA_VAULT_MIN
  // );

  let thetaVaultUsers = mergeObjects(
    ribbonETHCALLThetaVaultUsers,
    ribbonETHPUTThetaVaultUsers,
    ribbonBTCCALLThetaVaultUsers /*, ribbonBTCPUTThetaVaultUsers*/
  );
  let totalUSDSize = _.sum(
    Object.values(thetaVaultUsers).map((v) => parseInt(v))
  ).toString();

  //extra
  thetaVaultUsers = _.mapValues(thetaVaultUsers, function (v, k) {
    return AIRDROP_SCRIPT_PARAMS.VAULT_EXTRA_AMOUNT.mul(
      BigNumber.from(thetaVaultUsers[k])
    ).div(BigNumber.from(totalUSDSize));
  });

  //base
  thetaVaultUsers = _.mapValues(thetaVaultUsers, function (v, k) {
    return thetaVaultUsers[k].add(
      AIRDROP_SCRIPT_PARAMS.VAULT_BASE_AMOUNT.div(
        BigNumber.from(Object.keys(thetaVaultUsers).length.toString())
      )
    );
  });

  console.log(
    `Num Ribbon Theta Vault Users: ${Object.keys(thetaVaultUsers).length}\n`
  );

  masterBalance = mergeObjects(
    masterBalance,
    ribbonStrangleUsers,
    thetaVaultUsers
  );

  Object.keys(masterBalance).map(function (k, i) {
    masterBalance[k] = parseInt(
      masterBalance[k]
        .div(BigNumber.from("10").pow(BigNumber.from("18")))
        .toString()
    );
  });

  console.log(
    `Tokens to distribute: ${_.sum(
      Object.values(masterBalance)
    )} (we round down from 18 decimals token airdrop values)`
  );
  console.log(
    `Finished data extraction! Total Addresses: ${
      Object.keys(masterBalance).length
    }`
  );

  try {
    fs.writeFileSync(program.opts().file, JSON.stringify(masterBalance));
  } catch (err) {
    console.error(err);
  }

  console.log(`Wrote airdrop json into ${program.opts().file}\n`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
