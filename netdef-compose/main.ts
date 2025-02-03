import { Minimatch } from "minimatch";
import type { Promisable } from "type-fest";

import * as compose from "../compose/mod.js";
import { eUPF } from "../eupf/up.js";
import { f5CP, f5Options, f5UP } from "../free5gc/mod.js";
import { ndndpdkUP } from "../ndndpdk/upf.js";
import * as netdef from "../netdef/mod.js";
import { oaiCP, oaiOptions, oaiRAN, oaiUP, oaiUPvpp } from "../oai/mod.js";
import { bessOptions, bessUP, gnbsimRAN } from "../omec/mod.js";
import { o5CP, o5UP } from "../open5gs/mod.js";
import { packetrusherRAN } from "../packetrusher/netdef.js";
import { phoenixCP, phoenixOptions, phoenixRAN, phoenixUP } from "../phoenix/mod.js";
import { srsOptions, srsRAN } from "../srsran/mod.js";
import { ueransimOptions, ueransimRAN } from "../ueransim/netdef.js";
import { assert, file_io, Yargs, YargsCoercedArray } from "../util/mod.js";
import { annotateVm, useVm, useVmOptions } from "../virt/middleware.js";
import { NetDefComposeContext } from "./context.js";
import { defineDNServices, dnOptions, setDNCommands } from "./dn.js";
import { prometheus, prometheusOptions } from "./prometheus.js";

type Provider = (ctx: NetDefComposeContext, opts: typeof args) => Promisable<void>;
type UpProvider = (ctx: NetDefComposeContext, upf: netdef.UPF, opts: typeof args) => Promisable<void>;

const cpProviders: Record<string, Provider> = {
  free5gc: f5CP,
  oai: oaiCP,
  open5gs: o5CP,
  phoenix: phoenixCP,
};

const upProviders: Record<string, UpProvider> = {
  bess: bessUP,
  eupf: eUPF,
  free5gc: f5UP,
  ndndpdk: ndndpdkUP,
  oai: oaiUP,
  "oai-vpp": oaiUPvpp,
  open5gs: o5UP,
  phoenix: phoenixUP,
};

const ranProviders: Record<string, Provider> = {
  gnbsim: gnbsimRAN,
  oai: oaiRAN,
  packetrusher: packetrusherRAN,
  phoenix: phoenixRAN,
  srsran: srsRAN,
  ueransim: ueransimRAN,
};

const args = await Yargs()
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
    choices: Object.keys(cpProviders),
    default: "phoenix",
    desc: "Control Plane provider",
    type: "string",
  })
  .option("up", YargsCoercedArray({
    coerce(line): [pattern: Minimatch | undefined, provider: string] {
      const tokens = line.split("=");
      assert(tokens.length <= 2 && upProviders[tokens.at(-1)!], `bad --up=${line}`);
      if (tokens.length === 1) {
        return [undefined, tokens[0]!];
      }
      return [new Minimatch(tokens[0]!), tokens[1]!];
    },
    default: "phoenix",
    desc: "User Plane provider",
    type: "string",
  }))
  .option("ran", {
    choices: Object.keys(ranProviders),
    default: "phoenix",
    desc: "Radio Access Network provider",
    type: "string",
  })
  .option(compose.bridgeOptions)
  .option(compose.cpufreqOptions)
  .option(compose.ipAllocOptions())
  .option(compose.placeOptions)
  .option(compose.qosOptions)
  .option(bessOptions)
  .option(dnOptions)
  .option(f5Options)
  .option(oaiOptions)
  .option(phoenixOptions)
  .option(prometheusOptions)
  .option(srsOptions)
  .option(ueransimOptions)
  .option(useVmOptions)
  .middleware(useVm)
  .parseAsync();

const network = await file_io.readJSON(args.netdef);
netdef.validate(network);
const ctx = new NetDefComposeContext(network, args.out, new compose.IPAlloc(args));
defineDNServices(ctx, args);
for (const upf of netdef.listUpfs(network)) {
  const up = args.up.find(([pattern]) => pattern === undefined || pattern.match(upf.name));
  assert(up, `User Plane provider not found for ${upf.name}`);
  await upProviders[up[1]]!(ctx, upf, args);
}
setDNCommands(ctx);
await cpProviders[args.cp]!(ctx, args);
await ranProviders[args.ran]!(ctx, args);
await compose.saveQoS(ctx, args);
await prometheus(ctx, args);
await compose.defineBridge(ctx, args);
compose.makeCpufreqService(ctx, args);
compose.place(ctx.c, args);
annotateVm(ctx.c, args);
await ctx.finalSave();
