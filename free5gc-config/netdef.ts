import * as compose from "../compose/mod.js";
import type { NetDefComposeContext } from "../netdef-compose/context.js";
import * as NetDefDN from "../netdef-compose/dn.js";
import type * as F5 from "../types/free5gc.js";
import * as f5_conf from "./conf.js";

/**
 * Build UP functions using free5GC as UPF.
 */
export async function buildUP(ctx: NetDefComposeContext): Promise<void> {
  NetDefDN.defineDNServices(ctx);

  const dnnList: F5.upf.DN[] = ctx.network.dataNetworks.filter((dn) => dn.type === "IPv4").map((dn) => ({
    dnn: dn.dnn,
    cidr: dn.subnet!,
  }));

  for (const [ct, upf] of compose.suggestNames("upf", ctx.network.upfs)) {
    const s = ctx.defineService(ct, "5gdeploy.localhost/free5gc-upf", ["n3", "n4", "n6", "n9"]);
    const peers = ctx.netdef.gatherUPFPeers(upf);
    compose.setCommands(s, [
      ...compose.renameNetifs(s, { pipeworkWait: true }),
      ...NetDefDN.makeUPFRoutes(ctx, peers),
      "exec ./upf -c ./config/upfcfg.yaml",
    ]);
    const yamlFile = `up-cfg/${ct}.yaml`;
    s.volumes.push({
      type: "bind",
      source: `./${yamlFile}`,
      target: "/free5gc/config/upfcfg.yaml",
      read_only: true,
    });
    s.cap_add = ["NET_ADMIN"];

    const c = (await f5_conf.loadTemplate("upfcfg")) as F5.upf.Root;
    c.pfcp.addr = s.networks.n4!.ipv4_address;
    c.pfcp.nodeID = s.networks.n4!.ipv4_address;
    // go-upf gtp5g driver listens on the first interface defined in ifList and does not distinguish N3 or N9
    // https://github.com/free5gc/go-upf/blob/efae7532f8f9ed081065cdaa0589b0c76d11b204/internal/forwarder/driver.go#L53-L58
    c.gtpu.ifList = [{
      addr: "0.0.0.0",
      type: "N3",
    }];
    c.dnnList = dnnList;

    await ctx.writeFile(yamlFile, c);
  }

  NetDefDN.setDNCommands(ctx);
}
