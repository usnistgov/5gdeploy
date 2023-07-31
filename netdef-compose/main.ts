import fs from "node:fs/promises";
import path from "node:path";

import yaml from "js-yaml";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import * as compose from "../compose/mod.js";
import { NetDef } from "../netdef/netdef.js";
import { NetDefComposeContext } from "./context.js";
import { phoenixCP, phoenixRAN, phoenixUP } from "./phoenix.js";
import { RANProviders } from "./ran.js";

const cpProviders: Record<string, (ctx: NetDefComposeContext) => Promise<void>> = {
  phoenix: phoenixCP,
};

const upProviders: Record<string, (ctx: NetDefComposeContext) => Promise<void>> = {
  phoenix: phoenixUP,
};

const ranProviders: Record<string, (ctx: NetDefComposeContext) => Promise<void>> = {
  ...RANProviders,
  phoenix: phoenixRAN,
};

const args = await yargs(hideBin(process.argv))
  .option("netdef", {
    demandOption: true,
    desc: "network definition file",
    type: "string",
  })
  .option("out", {
    demandOption: true,
    desc: "Compose output directory",
    type: "string",
  })
  .option("cp", {
    desc: "Control Plane provider",
    default: "phoenix",
    choices: Object.keys(cpProviders),
    type: "string",
  })
  .option("up", {
    desc: "User Plane provider",
    default: "phoenix",
    choices: Object.keys(upProviders),
    type: "string",
  })
  .option("ran", {
    desc: "Radio Access Network provider",
    default: "phoenix",
    choices: Object.keys(ranProviders),
    type: "string",
  })
  .option(compose.bridgeOptions)
  .parseAsync();

const netdef = new NetDef(JSON.parse(await fs.readFile(args.netdef, "utf8")));
const ctx = new NetDefComposeContext(netdef, args.out);
await upProviders[args.up]!(ctx);
await cpProviders[args.cp]!(ctx);
await ranProviders[args.ran]!(ctx);
if (args.bridgeTo) {
  compose.defineBridge(ctx.c, args.bridgeTo, args.bridgeOn);
}
await fs.writeFile(path.resolve(args.out, "compose.yml"), yaml.dump(ctx.c, { forceQuotes: true, sortKeys: true }));
