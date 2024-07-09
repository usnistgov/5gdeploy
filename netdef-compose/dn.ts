import DefaultWeakMap from "mnemonist/default-weak-map.js";
import { Netmask } from "netmask";
import map from "obliterator/map.js";
import * as shlex from "shlex";
import assert from "tiny-invariant";

import * as compose from "../compose/mod.js";
import type { NetDef } from "../netdef/netdef.js";
import type { N } from "../types/mod.js";
import type { YargsInfer, YargsOptions } from "../util/mod.js";
import type { NetDefComposeContext } from "./context.js";

/** Yargs options definition for Data Networks. */
export const dnOptions = {
  "dn-workers": {
    default: 1,
    desc: "number of reserved CPU cores for each Data Network container",
    type: "number",
  },
} as const satisfies YargsOptions;
type DNOpts = YargsInfer<typeof dnOptions>;

const dnDockerImage = "5gdeploy.localhost/dn";
const upfRouteTableBase = 5000;
const upfRouteRulePriority = 100;

const ctxHasUniqueDNNs = new DefaultWeakMap<NetDefComposeContext, boolean>(
  (ctx) => new Set(map(ctx.network.dataNetworks, (dn) => dn.dnn)).size === ctx.network.dataNetworks.length,
);

function makeDNServiceName(ctx: NetDefComposeContext, dn: N.DataNetworkID): string {
  if (ctxHasUniqueDNNs.get(ctx)) {
    return `dn_${dn.dnn}`;
  }
  return `dn_${dn.snssai}_${dn.dnn}`;
}

/**
 * Define Compose services for Data Networks.
 *
 * @remarks
 * This shall be called before creating UPFs.
 */
export function defineDNServices(ctx: NetDefComposeContext, opts: DNOpts): void {
  const { "dn-workers": nWorkers } = opts;
  for (const dn of ctx.network.dataNetworks) {
    if (dn.type !== "IPv4") {
      continue;
    }
    const s = ctx.defineService(makeDNServiceName(ctx, dn), dnDockerImage, ["mgmt", "n6"]);
    compose.annotate(s, "cpus", nWorkers);
    compose.annotate(s, "dn", `${dn.snssai}_${dn.dnn}`);
  }
}

function* makeDNRoutes(ctx: NetDefComposeContext, dn: N.DataNetwork): Iterable<string> {
  const dest = new Netmask(dn.subnet!);
  yield `msg Adding routes for ${shlex.quote(`${dn.snssai}:${dn.dnn}`)} toward UPFs`;
  for (const [upfName, cost] of ctx.netdef.listDataPathPeers(dn)) {
    assert(typeof upfName === "string");
    const upf = ctx.c.services[upfName];
    assert(!!upf, `${upfName} container not found`);
    yield `ip route add ${dest} via ${upf.networks.n6!.ipv4_address} metric ${cost}`;
  }
  yield "msg Listing IP routes";
  yield "ip route list table all type unicast";
}

/**
 * Set commands on Compose services for Data Networks.
 *
 * @remarks
 * This shall be called after creating UPFs.
 */
export function setDNCommands(ctx: NetDefComposeContext): void {
  for (const dn of ctx.network.dataNetworks) {
    if (dn.type !== "IPv4") {
      continue;
    }

    const s = ctx.c.services[makeDNServiceName(ctx, dn)]!;
    compose.setCommands(s, [
      ...compose.renameNetifs(s),
      ...makeDNRoutes(ctx, dn),
      "exec tail -f",
    ], "ash");
  }
}

/**
 * Generate commands to configure routes for Data Networks in UPF.
 *
 * @remarks
 * This shall be called after {@link defineDNServices} and before {@link setDNCommands}.
 */
export function* makeUPFRoutes(ctx: NetDefComposeContext, peers: NetDef.UPFPeers): Iterable<string> {
  for (const dn of peers.N6IPv4) {
    const dnService = ctx.c.services[makeDNServiceName(ctx, dn)];
    const dest = new Netmask(dn.subnet!);
    const table = upfRouteTableBase + dn.index;
    yield `msg Adding routes for ${shlex.quote(`${dn.snssai}:${dn.dnn}`)} toward DN in table ${table}`;
    yield `ip rule add from ${dest} priority ${upfRouteRulePriority} table ${table}`;
    yield `ip route add default via ${dnService!.networks.n6!.ipv4_address} table ${table} metric ${dn.cost}`;
  }

  yield "msg Listing IP rules";
  yield "ip rule list";
  yield "msg Listing IP routes";
  yield "ip route list table all type unicast";
}
