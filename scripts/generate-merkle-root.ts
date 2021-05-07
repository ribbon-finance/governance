import { program } from "commander";
import fs from "fs";
import { parseBalanceMap } from "./helpers/parse-balance-map";

program
  .requiredOption(
    "-i, --input <path>",
    "input JSON file location containing a map of account addresses to string balances"
  )
  .requiredOption(
    "-n, --newFile <newFile>",
    "output JSON file location for merkle details"
  );

program.parse(process.argv);
const json = JSON.parse(
  fs.readFileSync(program.opts().input, { encoding: "utf8" })
);

if (typeof json !== "object") throw new Error("Invalid JSON");

let full = parseBalanceMap(json);

console.log(`Merkle Root:\n ${full["merkleRoot"]}`);

try {
  fs.writeFileSync(program.opts().newFile, JSON.stringify(full));
} catch (err) {
  console.error(err);
}

console.log(`Wrote full merkle json into ${program.opts().newFile}\n`);
