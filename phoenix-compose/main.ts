import path from "node:path";

import assert from "tiny-invariant";

import * as compose from "../compose/mod.js";
import { networkOptions, phoenixDockerImage, ScenarioFolder, updateService } from "../phoenix/mod.js";
import type { ComposeFile } from "../types/mod.js";
import { file_io, Yargs } from "../util/mod.js";

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

const c = compose.create();
for (const [net, subnet] of sf.ipmap.networks) {
  compose.defineNetwork(c, net, subnet.toString(), networkOptions[net]);
}

const skipNf = ["prometheus"];
if (args.ran) {
  skipNf.push("bt", "btup", "gnb", "ue");
}
for (const [ct, nets] of sf.ipmap.containers) {
  if (skipNf.includes(compose.nameToNf(ct))) {
    continue;
  }
  const service = compose.defineService(c, ct, phoenixDockerImage);
  for (const [net, ip] of nets) {
    compose.connectNetif(c, ct, net, ip);
  }
  updateService(service);
}

if (args.ran && args.ran !== "false") {
  const ran = await file_io.readYAML(args.ran) as ComposeFile;
  assert(ran.services);
  Object.assign(c.services, ran.services);
}

compose.defineBridge(c, args);
await file_io.write(path.resolve(args.out, "compose.yml"), c);
