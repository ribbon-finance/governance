import { program } from "commander";
import fs from "fs";
import { parseBalanceMap } from "./helpers/parse-balance-map";

program.requiredOption(
  "-i, --input <path>",
  "input JSON file location containing a map of account addresses to string balances"
);

program.parse(process.argv);
const json = JSON.parse(
  fs.readFileSync(program.opts().input, { encoding: "utf8" })
);

if (typeof json !== "object") throw new Error("Invalid JSON");

let full = parseBalanceMap(json);

console.log(`Merkle Root:\n ${full["merkleRoot"]}`);
console.log(`Full details:\n ${JSON.stringify(full)}`);
