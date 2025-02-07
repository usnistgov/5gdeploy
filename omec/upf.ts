import { compose, makeUPFRoutes, type netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { BESS } from "../types/mod.js";
import { YargsGroup, type YargsInfer, YargsIntRange } from "../util/mod.js";

const pfcpifaceDockerImage = "5gdeploy.localhost/omec-upf-pfcpiface";
const bessDockerImage = "5gdeploy.localhost/omec-upf-bess";

/** Aether BESS-UPF options. */
export const bessOptions = YargsGroup("BESS options:", {
  "bess-workers": YargsIntRange({
    default: 2,
    desc: "BESS UPF workers",
    max: 8,
  }),
});

/** Build Aether BESS-UPF. */
export async function bessUP(
    ctx: NetDefComposeContext, { name: ct, peers }: netdef.UPF,
    opts: YargsInfer<typeof bessOptions>,
): Promise<void> {
  const c: BESS.Config = {
    mode: "af_packet",
    access: {
      ifname: "n3",
    },
    core: {
      ifname: "n6",
    },
    cpiface: {
      peers: [],
      use_fqdn: false,
      enable_ue_ip_alloc: false,
    },
    enable_p4rt: false,
    enable_gtpu_path_monitoring: false,
    measure_flow: false,
    read_timeout: 0xFFFFFFFF,
    enable_notify_bess: false,
    enable_end_marker: false,
    log_level: "debug",
    qci_qos_config: [],
    enable_hbTimer: false,
    gtppsc: true,
    hwcksum: false,
    ddp: false,
    measure_upf: true,
    workers: opts["bess-workers"],
    table_sizes: {
      pdrLookup: 50000,
      flowMeasure: 200000,
      appQERLookup: 200000,
      sessionQERLookup: 100000,
      farLookup: 150000,
    },
  };
  const cfg = await ctx.writeFile(`up-cfg/${ct}.json`, c);

  const bess = ctx.defineService(ct, bessDockerImage, ["mgmt", "n4", "n3", "n6"]);
  compose.annotate(bess, "cpus", c.workers);
  bess.cap_add.push("IPC_LOCK");

  ctx.finalize.push(() => { // gNB IPs are available in ctx.finalize
    compose.setCommands(bess, (function*() {
      yield* compose.renameNetifs(bess);
      yield* makeUPFRoutes(ctx, peers);
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
      yield "iptables -I OUTPUT -p icmp --icmp-type port-unreachable -j DROP";
      yield "msg Starting bessd";
      yield "exec bessd -f -grpc-url=127.0.0.1:10514 -m=0";
    })(),
    );
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
