import path from "node:path";

import assert from "minimalistic-assert";

import * as compose from "../compose/mod.js";
import { ScenarioFolder } from "../phoenix/mod.js";
import { type ComposeFile } from "../types/compose.js";
import { file_io, Yargs } from "../util/mod.js";
import * as ph_compose from "./compose.js";

const args = Yargs()
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
  .parseSync();

const sf = await ScenarioFolder.load(args.cfg);
await sf.save(path.resolve(args.out, "cfg"), path.resolve(args.out, "sql"));

const composeFile = ph_compose.convert(sf.ipmap, !!args.ran);
if (args.ran && args.ran !== "false") {
  const ranCompose = (await file_io.readYAML(args.ran)) as ComposeFile;
  assert(ranCompose.services);
  Object.assign(composeFile.services, ranCompose.services);
}

compose.defineBridge(composeFile, args);

await file_io.write(path.resolve(args.out, "compose.yml"), composeFile);
