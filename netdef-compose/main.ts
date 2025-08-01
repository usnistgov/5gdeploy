import { Minimatch } from "minimatch";
import type { Promisable } from "type-fest";

import * as compose from "../compose/mod.js";
import { eUPF } from "../eupf/up.js";
import { f5CP, f5Options, f5UP } from "../free5gc/mod.js";
import { ndndpdkOptions, ndndpdkUP } from "../ndndpdk/upf.js";
import * as netdef from "../netdef/mod.js";
import { oaiCP, oaiOptions, oaiRAN, oaiUP, oaiUPvpp } from "../oai/mod.js";
import { bessOptions, bessUP, gnbsimRAN } from "../omec/mod.js";
import { o5CP, o5gOptions, o5UP } from "../open5gs/mod.js";
import { prushOptions, prushRAN } from "../packetrusher/ran.js";
import { phoenixCP, phoenixOptions, phoenixRAN, phoenixUP } from "../phoenix/mod.js";
import { srsOptions, srsRAN } from "../srsran/mod.js";
import { ueransimOptions, ueransimRAN } from "../ueransim/ran.js";
import { assert, file_io, Yargs, YargsCoercedArray } from "../util/mod.js";
import { annotateVm, useVm, useVmOptions } from "../virt/middleware.js";
import { NetDefComposeContext } from "./context.js";
import { defineDNServices, dnOptions, setDNCommands } from "./dn.js";
import { buildPrometheus, prometheusOptions } from "./prometheus.js";

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
  none: () => undefined,
  oai: oaiRAN,
  packetrusher: prushRAN,
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
    default: "free5gc",
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
    default: "free5gc",
    desc: "User Plane provider",
    type: "string",
  }))
  .option("ran", {
    choices: Object.keys(ranProviders),
    default: "ueransim",
    desc: "Radio Access Network provider",
    type: "string",
  })
  .option({
    ...bessOptions,
    ...compose.bridgeOptions,
    ...compose.cpufreqOptions,
    ...compose.ipAllocOptions(),
    ...compose.placeOptions,
    ...compose.qosOptions,
    ...dnOptions,
    ...f5Options,
    ...ndndpdkOptions,
    ...netdef.subscriberSingleDnOptions,
    ...o5gOptions,
    ...oaiOptions,
    ...phoenixOptions,
    ...prometheusOptions,
    ...prushOptions,
    ...srsOptions,
    ...ueransimOptions,
    ...useVmOptions,
  })
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
await buildPrometheus(ctx, args);
await compose.defineBridge(ctx, args);
compose.makeCpufreqService(ctx, args);
compose.place(ctx.c, args);
annotateVm(ctx.c, args);
await ctx.finalSave();
