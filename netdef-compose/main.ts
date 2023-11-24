import fs from "node:fs/promises";

import getStdin from "get-stdin";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import * as compose from "../compose/mod.js";
import { f5CP, f5UP } from "../free5gc-config/netdef.js";
import { NetDef } from "../netdef/netdef.js";
import { oaiUPtiny, oaiUPvpp } from "../oai-config/netdef.js";
import { phoenixCP, phoenixOptions, phoenixRAN, phoenixUP } from "../phoenix-config/mod.js";
import { NetDefComposeContext } from "./context.js";
import { RANProviders } from "./ran.js";

type Providers = Record<string, (ctx: NetDefComposeContext, opts: typeof args) => Promise<void>>;

const cpProviders: Providers = {
  phoenix: phoenixCP,
  free5gc: f5CP,
};

const upProviders: Providers = {
  phoenix: phoenixUP,
  oai: oaiUPtiny,
  "oai-vpp": oaiUPvpp,
  free5gc: f5UP,
};

const ranProviders: Providers = {
  ...RANProviders,
  phoenix: phoenixRAN,
};

const args = await yargs(hideBin(process.argv))
  .strict()
  .option("netdef", {
    demandOption: true,
    desc: "network definition file, '-' for stdin",
    type: "string",
  })
  .option("out", {
    demandOption: true,
    desc: "Compose output directory",
    type: "string",
  })
  .option("ip-space", {
    desc: "Compose networks IP address space, /18 or larger",
    default: "172.25.192.0/18",
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
  .option(phoenixOptions)
  .parseAsync();

const netdef = new NetDef(JSON.parse(await (args.netdef === "-" ? getStdin() : fs.readFile(args.netdef, "utf8"))));
netdef.validate();
const ctx = new NetDefComposeContext(netdef, args.out, { ipSpace: args.ipSpace });
await upProviders[args.up]!(ctx, args);
await cpProviders[args.cp]!(ctx, args);
await ranProviders[args.ran]!(ctx, args);
compose.defineBridge(ctx.c, args);
await ctx.writeFile("compose.yml", ctx.c);
