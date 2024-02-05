import fs from "node:fs/promises";

import getStdin from "get-stdin";

import * as compose from "../compose/mod.js";
import { f5CP, f5UP } from "../free5gc/netdef.js";
import { NetDef } from "../netdef/netdef.js";
import { oaiCP, oaiOptions, oaiRAN, oaiUP, oaiUPvpp } from "../oai/mod.js";
import { gnbsimRAN } from "../omec/gnbsim.js";
import { packetrusherRAN } from "../packetrusher/netdef.js";
import { phoenixCP, phoenixOptions, phoenixRAN, phoenixUP } from "../phoenix/mod.js";
import { ueransimRAN } from "../ueransim/netdef.js";
import { Yargs } from "../util/yargs.js";
import { NetDefComposeContext } from "./context.js";
import { dnOptions, saveDNOptions } from "./dn.js";
import { IPAlloc, ipAllocOptions } from "./ipalloc.js";

type Providers = Record<string, (ctx: NetDefComposeContext, opts: typeof args) => Promise<void>>;

const cpProviders: Providers = {
  free5gc: f5CP,
  oai: oaiCP,
  phoenix: phoenixCP,
};

const upProviders: Providers = {
  free5gc: f5UP,
  oai: oaiUP,
  "oai-vpp": oaiUPvpp,
  phoenix: phoenixUP,
};

const ranProviders: Providers = {
  gnbsim: gnbsimRAN,
  oai: oaiRAN,
  packetrusher: packetrusherRAN,
  phoenix: phoenixRAN,
  ueransim: ueransimRAN,
};

const args = Yargs()
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
  .middleware(saveDNOptions)
  .option(phoenixOptions)
  .option(oaiOptions)
  .parseSync();

const netdef = new NetDef(JSON.parse(await (args.netdef === "-" ? getStdin() : fs.readFile(args.netdef, "utf8"))));
netdef.validate();
const ctx = new NetDefComposeContext(netdef, args.out, new IPAlloc(args));
await upProviders[args.up]!(ctx, args);
await cpProviders[args.cp]!(ctx, args);
await ranProviders[args.ran]!(ctx, args);
compose.defineBridge(ctx.c, args);
await Promise.all(Array.from(
  compose.splitOutput(ctx.c, args),
  ([filename, body]) => ctx.writeFile(filename, body, { executable: filename.endsWith(".sh") }),
));
