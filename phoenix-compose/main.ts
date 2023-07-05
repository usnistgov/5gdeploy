import fs from "node:fs/promises";
import path from "node:path";

import yaml from "js-yaml";
import stringify from "json-stable-stringify";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { NetDef } from "../netdef/netdef.js";
import { applyNetdef as phApplyNetdef, ScenarioFolder } from "../phoenix-config/mod.js";
import * as compose from "./compose.js";

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
  .option("netdef", {
    desc: "apply network definition file",
    type: "string",
  })
  .option("ran", {
    desc: "replace RAN simulator with services in specified Compose file",
    type: "string",
  })
  .option("bridge-on", {
    desc: "bridge specified networks only",
    type: "string",
  })
  .option("bridge-to", {
    desc: "bridge to list of IP addresses",
    type: "string",
  })
  .parseAsync();

const folder = await ScenarioFolder.load(args.cfg);
let netdef: NetDef | undefined;
if (args.netdef) {
  netdef = new NetDef(JSON.parse(await fs.readFile(args.netdef, "utf8")));
  phApplyNetdef(folder, netdef);
}
await folder.save(path.resolve(args.out, "cfg"), path.resolve(args.out, "sql"));

const composeFile = compose.convert(folder.ipmap, !!args.ran);
if (args.ran && args.ran !== "false") {
  const ranCompose = yaml.load(await fs.readFile(args.ran, "utf8")) as any;
  Object.assign(composeFile.services, ranCompose.services);
}

if (args["bridge-to"]) {
  const bridgeOn = args["bridge-on"] ? new Set(args["bridge-on"].split(",")) : new Set();
  const bridges = Object.keys(composeFile.networks)
    .map((br) => br.replace(/^br-/, ""))
    .filter((br) => bridgeOn.size === 0 ? br !== "mgmt" : bridgeOn.has(br))
    .sort((a, b) => a.localeCompare(b));
  composeFile.services.bridge = {
    container_name: "bridge",
    hostname: "bridge",
    image: "5gdeploy.localhost/bridge",
    command: ["/entrypoint.sh", bridges.join(","), args["bridge-to"]],
    cap_add: ["NET_ADMIN"],
    devices: [],
    sysctls: {},
    volumes: [],
    environment: {},
    network_mode: "host",
    networks: {},
  };
}

await fs.writeFile(path.resolve(args.out, "compose.yml"), stringify(composeFile, { space: 2 }));
