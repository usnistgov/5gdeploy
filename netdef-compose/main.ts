import * as compose from "../compose/mod.js";
import { f5CP, f5UP } from "../free5gc/netdef.js";
import { NetDef } from "../netdef/netdef.js";
import { oaiCP, oaiOptions, oaiRAN, oaiUP, oaiUPvpp } from "../oai/mod.js";
import { gnbsimRAN } from "../omec/gnbsim.js";
import { packetrusherRAN } from "../packetrusher/netdef.js";
import { phoenixCP, phoenixOptions, phoenixRAN, phoenixUP } from "../phoenix/mod.js";
import type { N } from "../types/mod.js";
import { ueransimRAN } from "../ueransim/netdef.js";
import { file_io, Yargs } from "../util/mod.js";
import { NetDefComposeContext } from "./context.js";
import { dnOptions, saveDNOptions } from "./dn.js";
import { IPAlloc, ipAllocOptions } from "./ipalloc.js";
import { prometheus, prometheusFinish, prometheusOptions } from "./prometheus.js";
import { qosOptions, saveQoS } from "./qos.js";

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
  .option(compose.placeOptions)
  .option(ipAllocOptions)
  .option(dnOptions)
  .middleware(saveDNOptions)
  .option(qosOptions)
  .option(prometheusOptions)
  .option(phoenixOptions)
  .option(oaiOptions)
  .parseSync();

const netdef = new NetDef(await file_io.readJSON(args.netdef) as N.Network);
netdef.validate();
const ctx = new NetDefComposeContext(netdef, args.out, new IPAlloc(args));
await upProviders[args.up]!(ctx, args);
await cpProviders[args.cp]!(ctx, args);
await ranProviders[args.ran]!(ctx, args);
await prometheus(ctx, args);
await saveQoS(ctx, args);
compose.defineBridge(ctx.c, args);
compose.place(ctx.c, args);
await prometheusFinish(ctx);
await ctx.writeFile("compose.yml", ctx.c);
await ctx.writeFile("compose.sh", compose.makeScript(ctx.c));
