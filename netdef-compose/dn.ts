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
    s.sysctls["net.ipv4.conf.all.forwarding"] = 1;
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
      yield* compose.waitNetifs(s, { disableTxOffload: true });

      yield `msg Adding routes for ${shlex.quote(`${snssai}:${dnn}`)} toward UPFs`;
      for (const [upfName, cost] of netdef.listDataPathPeers(network, dn)) {
        assert(typeof upfName === "string");
        yield `ip route replace ${new Netmask(subnet!)} via ${compose.getIP(c, upfName, "n6")} metric ${cost}`;
      }

      yield "msg Listing IP routes";
      yield "ip route list table all type unicast";

      yield "exec tail -f";
    })(), { shell: "ash" });
  }
}

/**
 * Generate commands to configure routes for Data Networks in UPF.
 *
 * @remarks
 * This shall be called after {@link defineDNServices} and before {@link setDNCommands}.
 */
export function* makeUPFRoutes(
    { c }: NetDefComposeContext,
    peers: netdef.UPF.Peers,
    { upfNetif, upfNetifNeigh = false }: makeUPFRoutes.Options = {},
): Iterable<string> {
  for (const { index, snssai, dnn, subnet, cost } of peers.N6IPv4) {
    const dest = new Netmask(subnet!);
    const table = upfRouteTableBase + index;
    yield `msg Adding routes for ${shlex.quote(`${snssai}:${dnn}`)} toward DN in table ${table}`;
    yield `ip rule add from ${dest} priority ${upfRouteRulePriority} table ${table}`;
    yield `ip route replace default via ${compose.getIP(c, `dn_${dnn}`, "n6")} table ${table} metric ${cost}`;
    if (upfNetif) {
      if (upfNetifNeigh) {
        yield `ip neigh add ${dest.last} lladdr ${compose.ip2mac(dest.last)} nud permanent dev ${upfNetif}`;
        yield `ip route replace ${dest} via ${dest.last} dev ${upfNetif} onlink metric 0`;
      } else {
        yield `ip route replace ${dest} dev ${upfNetif} metric 0`;
      }
    }
  }

  yield "msg Listing IP rules";
  yield "ip rule list";
  yield "msg Listing IP routes";
  yield "ip route list table all type unicast";
}
export namespace makeUPFRoutes {
  /** {@link makeUPFRoutes} options */
  export interface Options {
    /**
     * TUN/TAP netif of the UPF software, will create back-route to it.
     * This is not escaped and bash variables may be used.
     */
    upfNetif?: string;

    /**
     * If set to true, static ARP entries are inserted.
     * This allows kernel to forward traffic to the UPF without sending ARP requests.
     */
    upfNetifNeigh?: boolean;
  }
}
