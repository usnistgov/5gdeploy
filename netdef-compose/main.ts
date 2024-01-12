import fs from "node:fs/promises";

import getStdin from "get-stdin";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import * as compose from "../compose/mod.js";
import { f5CP, f5UP } from "../free5gc/netdef.js";
import { NetDef } from "../netdef/netdef.js";
import { oaiCP } from "../oai/cn5g.js";
import { oaiUPtiny, oaiUPvpp } from "../oai/netdef.js";
import { phoenixCP, phoenixOptions, phoenixRAN, phoenixUP } from "../phoenix/mod.js";
import { NetDefComposeContext } from "./context.js";
import { dnOptions, saveDNOptions } from "./dn.js";
import { IPAlloc, ipAllocOptions } from "./ipalloc.js";
import { RANProviders } from "./ran.js";

type Providers = Record<string, (ctx: NetDefComposeContext, opts: typeof args) => Promise<void>>;

const cpProviders: Providers = {
  phoenix: phoenixCP,
  free5gc: f5CP,
  oai: oaiCP,
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
  .option(compose.splitOptions)
  .option(ipAllocOptions)
  .option(dnOptions)
  .option(phoenixOptions)
  .parseAsync();

const netdef = new NetDef(JSON.parse(await (args.netdef === "-" ? getStdin() : fs.readFile(args.netdef, "utf8"))));
netdef.validate();
saveDNOptions(args);
const ctx = new NetDefComposeContext(netdef, args.out, new IPAlloc(args));
await upProviders[args.up]!(ctx, args);
await cpProviders[args.cp]!(ctx, args);
await ranProviders[args.ran]!(ctx, args);
compose.defineBridge(ctx.c, args);
await Promise.all(Array.from(
  compose.splitOutput(ctx.c, args),
  ([filename, body]) => ctx.writeFile(filename, body, { executable: filename.endsWith(".sh") }),
));
