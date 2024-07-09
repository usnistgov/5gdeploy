import assert from "node:assert";

import { Minimatch } from "minimatch";
import type { Promisable } from "type-fest";

import * as compose from "../compose/mod.js";
import { f5CP, f5UP } from "../free5gc/mod.js";
import { ndndpdkUP } from "../ndndpdk/upf.js";
import { NetDef } from "../netdef/netdef.js";
import { oaiCP, oaiOptions, oaiRAN, oaiUP, oaiUPvpp } from "../oai/mod.js";
import { bessUP, gnbsimRAN } from "../omec/mod.js";
import { packetrusherRAN } from "../packetrusher/netdef.js";
import { phoenixCP, phoenixOptions, phoenixRAN, phoenixUP } from "../phoenix/mod.js";
import { srsOptions, srsRAN } from "../srsran/mod.js";
import type { N } from "../types/mod.js";
import { ueransimOptions, ueransimRAN } from "../ueransim/netdef.js";
import { file_io, Yargs } from "../util/mod.js";
import { makeScript } from "./compose-sh.js";
import { NetDefComposeContext } from "./context.js";
import { defineDNServices, dnOptions, setDNCommands } from "./dn.js";
import { IPAlloc, ipAllocOptions } from "./ipalloc.js";
import { prometheus, prometheusOptions } from "./prometheus.js";
import { qosOptions, saveQoS } from "./qos.js";

type Provider = (ctx: NetDefComposeContext, opts: typeof args) => Promisable<void>;
type UpProvider = (ctx: NetDefComposeContext, upf: N.UPF, opts: typeof args) => Promisable<void>;

const cpProviders: Record<string, Provider> = {
  free5gc: f5CP,
  oai: oaiCP,
  phoenix: phoenixCP,
};

const upProviders: Record<string, UpProvider> = {
  bess: bessUP,
  free5gc: f5UP,
  ndndpdk: ndndpdkUP,
  oai: oaiUP,
  "oai-vpp": oaiUPvpp,
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
    choices: Object.keys(cpProviders),
    default: "phoenix",
    desc: "Control Plane provider",
    type: "string",
  })
  .option("up", {
    array: true,
    coerce(lines: readonly string[]): Array<[pattern: Minimatch | undefined, provider: keyof UpProvider]> {
      const choices = Object.keys(upProviders);
      return Array.from(lines, (line) => {
        const tokens = line.split("=");
        assert(tokens.length <= 2 && choices.includes(tokens.at(-1)!), `bad --up=${line}`);
        if (tokens.length === 1) {
          return [undefined, tokens[0]! as keyof UpProvider];
        }
        return [new Minimatch(tokens[0]!), tokens[1]! as keyof UpProvider];
      });
    },
    default: "phoenix",
    desc: "User Plane provider",
    type: "string",
  })
  .option("ran", {
    choices: Object.keys(ranProviders),
    default: "phoenix",
    desc: "Radio Access Network provider",
    type: "string",
  })
  .option(compose.bridgeOptions)
  .option(compose.placeOptions)
  .option(dnOptions)
  .option(ipAllocOptions)
  .option(oaiOptions)
  .option(phoenixOptions)
  .option(prometheusOptions)
  .option(qosOptions)
  .option(srsOptions)
  .option(ueransimOptions)
  .parseSync();

const netdef = new NetDef(await file_io.readJSON(args.netdef) as N.Network);
netdef.validate();
const ctx = new NetDefComposeContext(netdef, args.out, new IPAlloc(args));
defineDNServices(ctx, args);
for (const upf of ctx.network.upfs) {
  const up = args.up.find(([pattern]) => pattern === undefined || pattern.match(upf.name));
  assert(up, `User Plane provider not found for ${upf.name}`);
  await upProviders[up[1]]!(ctx, upf, args);
}
setDNCommands(ctx);
await cpProviders[args.cp]!(ctx, args);
await ranProviders[args.ran]!(ctx, args);
await saveQoS(ctx, args);
await prometheus(ctx, args);
compose.defineBridge(ctx.c, args);
compose.place(ctx.c, args);
for (const op of ctx.finalize) {
  await op();
}
await ctx.writeFile("compose.yml", ctx.c);
await ctx.writeFile("compose.sh", makeScript(ctx.c));
