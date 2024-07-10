import path from "node:path";

import * as compose from "../compose/mod.js";
import type { NetDefComposeContext } from "../netdef-compose/mod.js";
import type { N } from "../types/mod.js";
import { file_io } from "../util/mod.js";

/** Build OMEC BESS-UPF. */
export async function bessUP(ctx: NetDefComposeContext, upf: N.UPF): Promise<void> {
  const version = (await file_io.readText(path.join(import.meta.dirname, "upf/VERSION"), { once: true })).trim();
  const ct = upf.name;

  const c: any = await file_io.readJSON(path.join(import.meta.dirname, "upf/conf/upf.jsonc"));
  c.mode = "af_packet";
  c.access.ifname = "n3";
  c.core.ifname = "n6";
  c.cpiface.peers = ctx.gatherIPs("smf", "n4");
  c.read_timeout = 0xFFFFFFFF;
  c.log_level = "trace";
  const cfg = await ctx.writeFile(`up-cfg/${ct}.json`, c);

  const pfcpiface = ctx.defineService(ct, `upf-epc-pfcpiface:${version}`, ["mgmt", "n4", "n3", "n6"]);
  compose.setCommands(pfcpiface, [
    ...compose.renameNetifs(pfcpiface),
    "msg Waiting for bessd to become ready",
    "with_retry nc -z 127.0.0.1 10514",
    "sleep 15",
    "msg Starting pfcpiface",
    `exec pfcpiface -config /conf/${ct}.json`,
  ], "ash");
  cfg.mountInto({ s: pfcpiface, target: `/conf/${ct}.json` });

  const bess = ctx.defineService(ct.replace(/^upf/, "upfbess"), `upf-epc-bess:${version}`, []);
  bess.network_mode = `service:${ct}`;
  bess.cap_add.push("IPC_LOCK");
  bess.cap_add.push("NET_ADMIN");
  compose.setCommands(bess, [
    "iptables -I OUTPUT -p icmp --icmp-type port-unreachable -j DROP",
    "msg Starting bessd",
    "exec bessd -f -grpc-url=127.0.0.1:10514 -m=0",
  ]);

  const gui = ctx.defineService(ct.replace(/^upf/, "upfgui"), `upf-epc-bess:${version}`, []);
  gui.network_mode = `service:${ct}`;
  compose.setCommands(gui, [
    "sleep 10",
    "msg Loading BESS pipeline",
    "bessctl run up4",
    "msg Starting bessctl GUI",
    `exec bessctl http ${compose.getIP(pfcpiface, "mgmt")} 8000`,
  ]);
  cfg.mountInto({ s: gui, target: "/opt/bess/bessctl/conf/upf.jsonc" });

  const route = ctx.defineService(ct.replace(/^upf/, "upfroute"), `upf-epc-bess:${version}`, []);
  route.network_mode = `service:${ct}`;
  compose.setCommands(route, [
    "sleep 5",
    "msg Starting route_control",
    "exec /opt/bess/bessctl/conf/route_control.py -i n3 n6",
  ]);
}
