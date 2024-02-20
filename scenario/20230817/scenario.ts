import { file_io, Yargs } from "../../util/mod.js";
import * as phones_vehicles from "../common/phones-vehicles.js";

const args = Yargs()
  .option(phones_vehicles.cliOptions)
  .option("sst4", {
    default: false,
    desc: "move vcam+vctl to SST=4",
    type: "boolean",
  })
  .parseSync();

const network = phones_vehicles.buildNetwork(args, {
  internetSNSSAI: "01000000",
  internetUPF: "upf1",
  vcamSNSSAI: args.sst4 ? "04000000" : "8C000000",
  vcamUPF: "upf140",
  vctlSNSSAI: args.sst4 ? "04000000" : "8D000000",
  vctlUPF: "upf141",
});

await file_io.write("-.json", network);
