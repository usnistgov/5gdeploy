import * as compose from "../compose/mod.js";
import { makeUPFRoutes, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeFile, ComposeService, F5, N } from "../types/mod.js";
import * as f5_conf from "./conf.js";

/** Build free5GC UPF. */
export async function f5UP(ctx: NetDefComposeContext, upf: N.UPF): Promise<void> {
  const s = ctx.defineService(upf.name, await f5_conf.getTaggedImageName("upf"), ["n3", "n4", "n6", "n9"]);
  const peers = ctx.netdef.gatherUPFPeers(upf);
  compose.setCommands(s, [
    ...compose.renameNetifs(s),
    ...makeUPFRoutes(ctx, peers),
    "msg Starting free5GC UPF",
    "exec ./upf -c ./config/upfcfg.yaml",
  ]);
  dependOnGtp5g(s, ctx.c);

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

  await ctx.writeFile(`up-cfg/${upf.name}.yaml`, c, { s, target: "/free5gc/config/upfcfg.yaml" });
}

/** Declare a service that depends on gtp5g kernel module. */
export function dependOnGtp5g(dependant: ComposeService, c: ComposeFile): void {
  if (!c.services.gtp5g) {
    defineGtp5gLoader(c);
  }

  dependant.depends_on.gtp5g = {
    condition: "service_completed_successfully",
  };
}

function defineGtp5gLoader(c: ComposeFile): void {
  const s = compose.defineService(c, "gtp5g", "5gdeploy.localhost/gtp5g");
  compose.annotate(s, "every_host", 1);

  s.network_mode = "none";
  s.cap_add.push("SYS_MODULE");
  s.volumes.push({
    type: "bind",
    source: "/etc/modules-load.d",
    target: "/etc/modules-load.d",
  }, {
    type: "bind",
    source: "/lib/modules",
    target: "/lib/modules",
  }, {
    type: "bind",
    source: "/usr/src",
    target: "/usr/src",
    read_only: true,
  });
}
