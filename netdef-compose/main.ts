import fs from "node:fs/promises";
import path from "node:path";

import stringify from "json-stable-stringify";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { NetDef } from "../netdef/netdef.js";
import { NetDefComposeContext } from "./context.js";
import { phoenixCore, phoenixRAN } from "./phoenix.js";

const coreProviders: Record<string, (ctx: NetDefComposeContext) => Promise<void>> = {
  phoenix: phoenixCore,
};

const ranProviders: Record<string, (ctx: NetDefComposeContext) => Promise<void>> = {
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
  .option("core", {
    desc: "core provider",
    default: "phoenix",
    choices: Object.keys(coreProviders),
    type: "string",
  })
  .option("ran", {
    desc: "RAN provider",
    default: "phoenix",
    choices: Object.keys(ranProviders),
    type: "string",
  })
  .parseAsync();

const netdef = new NetDef(JSON.parse(await fs.readFile(args.netdef, "utf8")));
const ctx = new NetDefComposeContext(netdef, args.out);
await coreProviders[args.core]!(ctx);
await ranProviders[args.ran]!(ctx);
await fs.writeFile(path.resolve(args.out, "compose.yml"), stringify(ctx.c, { space: 2 }));
