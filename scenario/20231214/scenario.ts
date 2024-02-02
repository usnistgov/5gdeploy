import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import * as phones_vehicles from "../common/phones-vehicles.js";

const args = await yargs(hideBin(process.argv))
  .strict()
  .option(phones_vehicles.cliOptions)
  .parseAsync();

const network = phones_vehicles.buildNetwork(args, {
  internetSNSSAI: "01000000",
  internetUPF: "upf0",
  vcamSNSSAI: "04000000",
  vcamUPF: "upf0",
  vctlSNSSAI: "04000000",
  vctlUPF: "upf0",
});

process.stdout.write(`${JSON.stringify(network)}\n`);
