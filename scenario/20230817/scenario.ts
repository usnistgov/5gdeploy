import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import * as phones_vehicles from "../common/phones-vehicles.js";

const args = yargs(hideBin(process.argv))
  .strict()
  .option(phones_vehicles.cliOptions)
  .parseSync();

const network = phones_vehicles.buildNetwork(args, {
  internetSNSSAI: "01000000",
  internetUPF: "upf1",
  vcamSNSSAI: "8C000000",
  vcamUPF: "upf140",
  vctlSNSSAI: "8D000000",
  vctlUPF: "upf141",
});

process.stdout.write(`${JSON.stringify(network)}\n`);
