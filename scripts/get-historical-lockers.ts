import fs from 'fs';
import { createObjectCsvWriter } from 'csv-writer';

const hre = require("hardhat");
const { ethers, network } = hre;
const { provider, getContractAt, BigNumber} = ethers;


/*
    Penalty Rebate METHODOLOGY

    To calculate a 50% penalty-free unlock, all we do
    is divide the penalty amount in the current mechanism by two
    and send this back to the user

    We divide by two because 50% unlock corresponds to:
    how much was kept originally + 50% of the penalty

    Example (without 50% penalty-free unlock):

    500 RBN, 2yr lock (75% penalty fee)
    Keep: 500 RBN * 25% = 125 RBN
    Penalty: 500 RBN * 75% = 375 RBN

    Example (with 50% penalty-free unlock):

    500 RBN, 2yr lock (75% penalty fee)
    Keep: 500 RBN * 50% (penalty-free) + 250 RBN * 25% = 312.5 RBN
    Penalty: 250 RBN * 75% = 187.5 RBN

    So, user calls force_withdraw on 500 RBN
    Initially, he keeps 125 RBN and 375 RBN is sent to penalty contract
    Penalty contract divides 375 RBN by 2 = 187.5 RBN and sends it back to locker
    Keep Final: 125 RBN + 187.5 RBN = 312.5 RBN
    Penalty Final: 187.5 RBN = 187.5 RBN

    This generalizes across all RBN lock sizes (not just 500 RBN) + lock times (not just 2yr)
*/

// ABI
const ABI = [
  "event Deposit(address indexed deposit_from, address indexed provider, uint256 value, uint256 indexed locktime, int128 type, uint256 ts)",
];

// Fork mainnet at block no 16699831
const FORK_BLOCK_NUMBER = 16699831;
// Use equivalent unix timestmap for block num
// Date of RGP-31 passing
// Fri Feb 24 2023 18:00:00 GMT+0000
const FORK_BLOCK_TIMESTAMP = 1677261600;

// This is for passing values into Penalty Escrow Contract
const FILENAME_TXT = "addresses_penalties_rebate.txt"
// This is for users to see difference
const FILENAME_CSV = "addresses_penalties_rebate.csv"

const VE_RBN = "0x19854C9A5fFa8116f48f984bDF946fB9CEa9B5f7"
const MULTIPLIER = 10 ** 18
const MAXTIME = 2 * 365 * 86400

function writeToCSV(records: Object[]){
  const csvWriter = createObjectCsvWriter({
    path: FILENAME_CSV,
    header: [
      {id: 'address', title: 'Address'},
      {id: 'balance', title: 'RBN Balance'},
      {id: 'time_left', title: 'Time Left (in seconds)'},
      {id: 'penalty_ratio', title: 'Penalty Ratio'},
      {id: 'penalty_rebate', title: 'Penalty Rebate'},
      {id: 'unlock_reward_before', title: 'Unlock Reward Before'},
      {id: 'unlock_reward_after', title: 'Unlock Reward After'},
    ]
  });

  csvWriter.writeRecords(records)
    .then(() => {
      console.log('CSV file written successfully');
    });
}

function writeToTXT(addresses: string[], penaltyRebates: string[]){
  // Convert the array to a JSON string
  const addressesJSON = JSON.stringify(addresses);
  // Write the JSON string to a file
  fs.writeFile(FILENAME_TXT, addressesJSON, (err) => {});
  // Write the JSON string to a file
  fs.writeFile(FILENAME_TXT, "\n", (err) => {});
  // Convert the array to a JSON string
  const penaltyRebatesJSON = JSON.stringify(penaltyRebates);
  // Write the JSON string to a file
  fs.appendFile(FILENAME_TXT, penaltyRebatesJSON, (err) => {});

  console.log('TXT file written successfully');
}

/*
  Using all Deposit Events emitted up until block number,
  find all the addresses that locked RBN.
*/
async function getAllHistoricalLockers() {
  const provider = new ethers.providers.JsonRpcProvider(process.env.MAINNET_URI);

  const depositEvents = await (new ethers.Contract(VE_RBN, ABI, provider)).queryFilter("Deposit", 0, FORK_BLOCK_NUMBER);

  const addresses: string[] = Array.from(new Set(depositEvents.map((event: any): string => event.args.provider.toString())));

  return addresses;
}

// Filters addresses, calculates penalty rebate
async function getFilteredAddressesAndPenaltyRebate(allAddresses: string[], filteredAddresses: string[], penaltyRebates: string[], csvData: Object[]){

    // Reset to relevant block
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URI,
            blockNumber: FORK_BLOCK_NUMBER
          }
        }
      ]
    });

    const contract = await getContractAt("IVotingEscrow", VE_RBN)

    let numAddresses = allAddresses.length
    let ctr = 0
    for (const address of allAddresses) {
      ctr += 1

      // Get RBN locked balance + unix timestamp of lock expiry
      const [balance, lockedEnd] = await contract.locked(address);

      /*
        Filters addresses by:
           1. RBN locked < 1 RBN
           2. lock expiry < fork timestamp

        In both case, we do not need to provide penalty rebate to address
      */

      if (balance < MULTIPLIER || lockedEnd < FORK_BLOCK_TIMESTAMP) {
        continue;
      }

      // Recalculate penalty for address at given block
      const timeLeft = lockedEnd - FORK_BLOCK_TIMESTAMP;
      const penaltyRatio = Math.min(MULTIPLIER * 3 / 4, MULTIPLIER * timeLeft / MAXTIME);
      const penalty = balance * penaltyRatio / MULTIPLIER

      // Calculate rebate for equivalent of 50% unlock penalty-free (SEE METHODOLOGY)
      const penaltyRebate = (penalty / 2)
      // Scale to string (no scientific notation)
      let penaltyRebateToStandardform = penaltyRebate.toLocaleString('fullwide', {useGrouping:false})

      filteredAddresses.push(address)
      penaltyRebates.push(penaltyRebateToStandardform)
      csvData.push(
        {
          address: address,
          balance: `${(balance / MULTIPLIER).toFixed(2)} RBN`,
          time_left: timeLeft,
          penalty_ratio: (penaltyRatio / MULTIPLIER).toFixed(2),
          penalty_rebate: `${(parseInt(penaltyRebateToStandardform) / MULTIPLIER).toFixed(2)} RBN`,
          unlock_reward_before: `${((balance - penalty) / MULTIPLIER).toFixed(2)} RBN`,
          unlock_reward_after: `${((balance - penalty + penaltyRebate) / MULTIPLIER).toFixed(2)} RBN`
        }
      )

      console.log(`${ctr}/${numAddresses}(${address}): balance: ${Math.floor((balance / MULTIPLIER)).toFixed()} , time_left: ${timeLeft}, penaltyRebate: ${(Math.floor(parseInt(penaltyRebateToStandardform) / MULTIPLIER)).toFixed()}`);
    }
}

async function main() {
  const allAddresses = await getAllHistoricalLockers();

  let filteredAddresses: string[] = []
  let penaltyRebates: string[] = []

  let csvData: Object[] = []

  await getFilteredAddressesAndPenaltyRebate(allAddresses, filteredAddresses, penaltyRebates, csvData);

  console.log(`Total of ${filteredAddresses.length} addresses are eligible`)
  writeToTXT(filteredAddresses, penaltyRebates);
  writeToCSV(csvData);
}


main().catch((error) => {
  console.error(error);
  process.exit(1);
});
