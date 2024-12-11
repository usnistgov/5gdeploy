import type { PartialDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import { makeUPFRoutes, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { N, O5G } from "../types/mod.js";
import { configureMetrics, makeLaunchCommands, o5DockerImage } from "./common.js";

/** Build Open5GS UPF. */
export async function o5UP(ctx: NetDefComposeContext, upf: N.UPF): Promise<void> {
  const s = ctx.defineService(upf.name, o5DockerImage, ["mgmt", "n4", "n6", "n3"]);
  s.devices.push("/dev/net/tun:/dev/net/tun");
  compose.annotate(s, "cpus", 1);

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
      metrics: configureMetrics(s),
    },
  };

  compose.setCommands(s, [
    "msg Creating ogstun network interface",
    "ip tuntap add name ogstun mode tun",
    "ip link set ogstun up",
    ...compose.renameNetifs(s),
    ...makeUPFRoutes(ctx, peers, "ogstun"),
    ...makeLaunchCommands(upf.name, cfg),
  ]);
}
