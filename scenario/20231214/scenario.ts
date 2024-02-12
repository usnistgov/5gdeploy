import { file_io, Yargs } from "../../util/mod.js";
import * as phones_vehicles from "../common/phones-vehicles.js";

const args = Yargs()
  .option(phones_vehicles.cliOptions)
  .parseSync();

const network = phones_vehicles.buildNetwork(args, {
  internetSNSSAI: "01000000",
  internetUPF: "upf0",
  vcamSNSSAI: "04000000",
  vcamUPF: "upf0",
  vctlSNSSAI: "04000000",
  vctlUPF: "upf0",
});

await file_io.write("-.json", network);
