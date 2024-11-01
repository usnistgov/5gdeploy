import type { PartialDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import { makeUPFRoutes, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { N, O5G } from "../types/mod.js";

/** Build Open5GS UPF. */
export async function o5UP(ctx: NetDefComposeContext, upf: N.UPF): Promise<void> {
  const s = ctx.defineService(upf.name, "5gdeploy.localhost/open5gs", ["mgmt", "n4", "n6", "n3"]);
  s.user = "root";
  s.devices.push("/dev/net/tun:/dev/net/tun");
  compose.annotate(s, "cpus", 1);

  const target = new URL("http://localhost:9091/metrics");
  target.hostname = compose.getIP(s, "mgmt");
  target.searchParams.set("job_name", "open5gs");
  target.searchParams.append("labels", `nf=${s.container_name}`);
  compose.annotate(s, "prometheus_target", target.toString());

  const peers = ctx.netdef.gatherUPFPeers(upf);
  const cfg: PartialDeep<O5G.upf.Root> = {
    upf: {
      pfcp: {
        server: [{ dev: "n4" }],
      },
      gtpu: {
        server: [{ dev: "n3" }],
      },
      session: Array.from(
        [...peers.N6IPv4, ...peers.N6IPv6],
        ({ subnet }) => ({
          subnet: subnet!,
        }),
      ),
      metrics: {
        server: [{ dev: "mgmt", port: 9091 }],
      },
    },
  };

  compose.setCommands(s, [
    "msg Creating ogstun network interface",
    "ip tuntap add name ogstun mode tun",
    "ip link set ogstun up",
    ...compose.renameNetifs(s),
    ...makeUPFRoutes(ctx, peers, "ogstun"),
    "msg Preparing Open5GS UPF config",
    ...compose.mergeConfigFile(cfg, {
      base: "/opt/open5gs/etc/open5gs/upf.yaml",
      merged: `/${upf.name}.yaml`,
    }),
    "msg Starting Open5GS UPF",
    `exec yasu open5gs open5gs-upfd -c /${upf.name}.yaml`,
  ]);
}
