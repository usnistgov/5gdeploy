import assert from "minimalistic-assert";

import * as compose from "../compose/mod.js";
import type { NetDefComposeContext } from "../netdef-compose/context.js";
import { phoenixUP } from "../netdef-compose/phoenix.js";
import type * as F5 from "../types/free5gc.js";
import * as f5_conf from "./conf.js";

/**
 * Build UP functions using free5GC as UPF.
 */
export async function buildUP(ctx: NetDefComposeContext): Promise<void> {
  const upfInit = new Map<string, string[]>();
  await phoenixUP(ctx, {
    editSF: async (sf) => {
      for (const { name: ct } of ctx.network.upfs) {
        sf.delete(`${ct}.json`);
        upfInit.set(ct, Array.from(sf.other.listCommands(ct).filter((cmd) => /^ip (?:rule |route add default )/.test(cmd)),
          (cmd) => cmd.replaceAll("iif n6_tun ", "")
            .replaceAll(/\$[\dA-Z_]+_IP/g, (env) => sf.ipmap.resolveEnv(env.slice(1)) ?? env),
        ));
      }
    },
  });

  const dnnList: F5.upf.DN[] = ctx.network.dataNetworks.filter((dn) => dn.type === "IPv4").map((dn) => ({
    dnn: dn.dnn,
    cidr: dn.subnet!,
  }));

  for (const { name: ct } of ctx.network.upfs) {
    const s = ctx.c.services[ct];
    assert(!!s);
    s.image = await f5_conf.getImage("upf");
    compose.setCommands(s, [
      "set -euo pipefail",
      ...compose.renameNetifs(s),
      ...upfInit.get(ct)!,
      "exec ./upf -c ./config/upfcfg.yaml",
    ]);
    const yamlFile = `up-cfg/${ct}.yaml`;
    s.volumes.push({
      type: "bind",
      source: `./${yamlFile}`,
      target: "/free5gc/config/upfcfg.yaml",
      read_only: true,
    });
    s.cap_add.splice(0, Infinity, "NET_ADMIN");

    const c = (await f5_conf.loadTemplate("upfcfg")) as F5.upf.Root;
    c.pfcp.addr = s.networks.n4!.ipv4_address;
    c.pfcp.nodeID = s.networks.n4!.ipv4_address;
    // go-upf gtp5g driver listens on the first interface defined in ifList and does not distinguish N3 or N9
    // https://github.com/free5gc/go-upf/blob/efae7532f8f9ed081065cdaa0589b0c76d11b204/internal/forwarder/driver.go#L53-L58
    c.gtpu.ifList.splice(0, Infinity, {
      addr: "0.0.0.0",
      type: "N3",
    });
    c.dnnList = dnnList;

    await ctx.writeFile(yamlFile, c);
  }
}
