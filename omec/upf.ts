import path from "node:path";

import { compose, makeUPFRoutes, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { N } from "../types/mod.js";
import { file_io } from "../util/mod.js";

const pfcpifaceDockerImage = "5gdeploy.localhost/omec-upf-pfcpiface";
const bessDockerImage = "5gdeploy.localhost/omec-upf-bess";

/** Build OMEC BESS-UPF. */
export async function bessUP(ctx: NetDefComposeContext, upf: N.UPF): Promise<void> {
  const ct = upf.name;

  const c: any = await file_io.readJSON(path.join(import.meta.dirname, "upf/conf/upf.jsonc"));
  c.mode = "af_packet";
  c.log_level = "debug";
  c.gtppsc = true;
  c.access.ifname = "n3";
  c.core.ifname = "n6";
  c.workers = 2;
  c.read_timeout = 0xFFFFFFFF;
  c.cpiface = { peers: [] };
  c.p4rtciface = {};
  c.qci_qos_config = [];
  delete c.sim;
  delete c.slice_rate_limit_config;
  const cfg = await ctx.writeFile(`up-cfg/${ct}.json`, c);

  const bess = ctx.defineService(ct, bessDockerImage, ["mgmt", "n4", "n3", "n6"]);
  bess.sysctls["net.ipv6.conf.default.disable_ipv6"] = 1; // route_control.py don't pick up ICMPv6 RAs
  compose.annotate(bess, "cpus", c.workers);
  bess.cap_add.push("IPC_LOCK", "NET_ADMIN");
  const bessCommands = [
    // generate renameNetifs commands early, before netifs are detached in bridge configuration
    ...compose.renameNetifs(bess),
    ...makeUPFRoutes(ctx, netdef.gatherUPFPeers(ctx.network, upf)),
  ];
  ctx.finalize.push(() => { // gNB IPs are available in ctx.finalize
    compose.setCommands(bess, [
      ...bessCommands,
      ...(function*() {
        yield "n3_routes() {";
        yield "  while true; do";
        for (const gnb of compose.listByNf(ctx.c, "gnb")) {
          const [ip, mac] = compose.getIPMAC(gnb, "n3");
          yield `    ip neigh replace ${ip} lladdr ${mac} nud permanent dev n3`;
          yield `    ip route replace ${ip} via ${ip}`; // trigger n3Dst* creation by route_control.py
        }
        yield "    sleep 10";
        yield "  done";
        yield "}";
        yield "n3_routes &";
      })(),
      "iptables -I OUTPUT -p icmp --icmp-type port-unreachable -j DROP",
      "msg Starting bessd",
      "exec bessd -f -grpc-url=127.0.0.1:10514 -m=0",
    ]);
  });

  const pfcpiface = ctx.defineService(ct.replace(/^upf/, "upfpfcp"), pfcpifaceDockerImage, []);
  pfcpiface.network_mode = `service:${bess.container_name}`;
  compose.setCommands(pfcpiface, [
    ...compose.waitReachable("bessd", ["127.0.0.1"], { mode: "nc:10514", sleep: 10 }),
    "msg Starting pfcpiface",
    `exec pfcpiface -config /conf/${ct}.json`,
  ], { shell: "ash" });
  cfg.mountInto({ s: pfcpiface, target: `/conf/${ct}.json` });

  const gui = ctx.defineService(ct.replace(/^upf/, "upfgui"), bessDockerImage, []);
  gui.network_mode = `service:${bess.container_name}`;
  compose.setCommands(gui, [
    ...compose.waitReachable("bessd", ["127.0.0.1"], { mode: "tcp:10514" }),
    "msg Loading BESS pipeline",
    "with_retry bessctl run up4",
    "msg Starting bessctl GUI",
    `exec bessctl http ${compose.getIP(bess, "mgmt")} 8000`,
  ]);
  cfg.mountInto({ s: gui, target: "/opt/bess/bessctl/conf/upf.jsonc" });

  const route = ctx.defineService(ct.replace(/^upf/, "upfroute"), bessDockerImage, []);
  route.network_mode = `service:${bess.container_name}`;
  route.pid = `service:${bess.container_name}`;
  compose.setCommands(route, [
    ...compose.waitReachable("bessd", ["127.0.0.1"], { mode: "tcp:10514" }),
    "msg Starting route_control",
    "exec /opt/bess/bessctl/conf/route_control.py -i n3 n6",
  ]);
}
