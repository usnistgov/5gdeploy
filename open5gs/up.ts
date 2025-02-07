import type { PartialDeep } from "type-fest";

import { compose, makeUPFRoutes, type netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { O5G } from "../types/mod.js";
import { makeLaunchCommands, makeMetrics, o5DockerImage } from "./common.js";

/** Build Open5GS UPF. */
export async function o5UP(ctx: NetDefComposeContext, { name: ct, peers }: netdef.UPF): Promise<void> {
  const s = ctx.defineService(ct, o5DockerImage, ["mgmt", "n4", "n6", "n3"]);
  compose.annotate(s, "cpus", 1);
  s.sysctls["net.ipv4.conf.all.forwarding"] = 1;
  s.devices.push("/dev/net/tun:/dev/net/tun");

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
      metrics: makeMetrics(s),
    },
  };

  compose.setCommands(s, [
    "msg Creating ogstun network interface",
    "ip tuntap add name ogstun mode tun",
    "ip link set ogstun up",
    ...compose.renameNetifs(s),
    ...makeUPFRoutes(ctx, peers, "ogstun"),
    ...makeLaunchCommands(ct, cfg),
  ]);
}
