import fs from "node:fs/promises";
import path from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import * as compose from "../compose/mod.js";
import { ScenarioFolder } from "../phoenix-config/mod.js";
import * as ph_compose from "./compose.js";

const args = await yargs(hideBin(process.argv))
  .option("cfg", {
    demandOption: true,
    desc: "Open5GCore cfg directory",
    type: "string",
  })
  .option("out", {
    demandOption: true,
    desc: "Compose output directory",
    type: "string",
  })
  .option("ran", {
    desc: "replace RAN simulator with services in specified Compose file",
    type: "string",
  })
  .option(compose.bridgeOptions)
  .parseAsync();

const sf = await ScenarioFolder.load(args.cfg);
await sf.save(path.resolve(args.out, "cfg"), path.resolve(args.out, "sql"));

const composeFile = ph_compose.convert(sf.ipmap, !!args.ran);
if (args.ran && args.ran !== "false") {
  const ranCompose = compose.parse(await fs.readFile(args.ran, "utf8"));
  Object.assign(composeFile.services, ranCompose.services);
}

if (args.bridge) {
  compose.defineBridge(composeFile, args.bridge);
}

await fs.writeFile(path.resolve(args.out, "compose.yml"), compose.save(composeFile));
