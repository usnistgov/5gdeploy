import { compose, makeUPFRoutes, type netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { F5 } from "../types/mod.js";
import * as f5_conf from "./conf.js";
import { dependOnGtp5g } from "./gtp5g.js";
import type { F5Opts } from "./options.js";

/** Build free5GC UPF. */
export async function f5UP(ctx: NetDefComposeContext, { name: ct, peers, nets }: netdef.UPF, opts: F5Opts): Promise<void> {
  const s = ctx.defineService(ct, await f5_conf.getTaggedImageName(opts, "upf"), nets);
  s.sysctls["net.ipv4.conf.all.forwarding"] = 1;
  f5_conf.mountTmpfsVolumes(s);
  compose.setCommands(s, [
    ...compose.waitNetifs(s),
    ...compose.applyQoS(s),
    ...makeUPFRoutes(ctx, peers),
    "msg Starting free5GC UPF",
    "exec ./upf -c ./config/upfcfg.yaml",
  ]);
  dependOnGtp5g(s, ctx.c, opts);

  const c = await f5_conf.loadTemplate("upfcfg") as F5.upf.Root;
  c.pfcp.addr = compose.getIP(s, "n4");
  c.pfcp.nodeID = compose.getIP(s, "n4");
  // go-upf gtp5g driver listens on the first interface defined in ifList and does not distinguish N3 or N9
  // https://github.com/free5gc/go-upf/blob/efae7532f8f9ed081065cdaa0589b0c76d11b204/internal/forwarder/driver.go#L53-L58
  c.gtpu.ifList = [{
    addr: "0.0.0.0",
    type: "N3",
  }];
  c.dnnList = ctx.network.dataNetworks.filter((dn) => dn.type === "IPv4").map((dn) => ({
    dnn: dn.dnn,
    cidr: dn.subnet!,
  }));

  await ctx.writeFile(`up-cfg/${ct}.yaml`, c, { s, target: "/free5gc/config/upfcfg.yaml" });
}
