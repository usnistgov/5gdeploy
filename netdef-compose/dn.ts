import { Netmask } from "netmask";
import * as shlex from "shlex";

import * as compose from "../compose/mod.js";
import * as netdef from "../netdef/mod.js";
import { assert, type YargsInfer, type YargsOptions } from "../util/mod.js";
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

/**
 * Define Compose services for Data Networks.
 *
 * @remarks
 * This shall be called before creating UPFs.
 */
export function defineDNServices(ctx: NetDefComposeContext, opts: DNOpts): void {
  const dnns = new Set<string>();
  for (const { dnn } of ctx.network.dataNetworks) {
    assert(!dnns.has(dnn), `DNN ${dnn} is defined more than once`);
    dnns.add(dnn);
  }

  const nWorkers = opts["dn-workers"];
  for (const { snssai, dnn } of ctx.network.dataNetworks.filter(({ type }) => type === "IPv4")) {
    const s = ctx.defineService(`dn_${dnn}`, dnDockerImage, ["mgmt", "n6"]);
    compose.annotate(s, "cpus", nWorkers);
    compose.annotate(s, "dn", `${snssai}_${dnn}`);
  }
}

/**
 * Set commands on Compose services for Data Networks.
 *
 * @remarks
 * This shall be called after creating UPFs.
 */
export function setDNCommands({ c, network }: NetDefComposeContext): void {
  for (const dn of network.dataNetworks) {
    const { snssai, dnn, subnet } = dn;
    const s = c.services[`dn_${dnn}`];
    if (!s) {
      continue;
    }

    compose.setCommands(s, (function*() {
      yield* compose.renameNetifs(s, { disableTxOffload: true });

      yield `msg Adding routes for ${shlex.quote(`${snssai}:${dnn}`)} toward UPFs`;
      for (const [upfName, cost] of netdef.listDataPathPeers(network, dn)) {
        assert(typeof upfName === "string");
        yield `ip route add ${new Netmask(subnet!)} via ${compose.getIP(c, upfName, "n6")} metric ${cost}`;
      }

      yield "msg Listing IP routes";
      yield "ip route list table all type unicast";

      yield "exec tail -f";
    })(), { shell: "ash" });
  }
}

/**
 * Generate commands to configure routes for Data Networks in UPF.
 * @param upfNetif - TUN/TAP netif of the UPF software, will create back-route to it.
 *
 * @remarks
 * This shall be called after {@link defineDNServices} and before {@link setDNCommands}.
 */
export function* makeUPFRoutes({ c }: NetDefComposeContext, peers: netdef.UPFPeers, upfNetif?: string): Iterable<string> {
  for (const { index, snssai, dnn, subnet, cost } of peers.N6IPv4) {
    const dest = new Netmask(subnet!);
    const table = upfRouteTableBase + index;
    yield `msg Adding routes for ${shlex.quote(`${snssai}:${dnn}`)} toward DN in table ${table}`;
    yield `ip rule add from ${dest} priority ${upfRouteRulePriority} table ${table}`;
    yield `ip route add default via ${compose.getIP(c, `dn_${dnn}`, "n6")} table ${table} metric ${cost}`;
    if (upfNetif) {
      yield `ip route add ${dest} dev ${upfNetif} metric 0`;
    }
  }

  yield "msg Listing IP rules";
  yield "ip rule list";
  yield "msg Listing IP routes";
  yield "ip route list table all type unicast";
}
