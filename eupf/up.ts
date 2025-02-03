
import { compose, netdef, type NetDefComposeContext } from "../netdef-compose/mod.js";
import type { ComposeService, EUPF, N } from "../types/mod.js";

/** Build eUPF. */
export async function eUPF(ctx: NetDefComposeContext, upf: N.UPF): Promise<void> {
  const peers = netdef.gatherUPFPeers(ctx.network, upf);
  const s = ctx.defineService(upf.name, "ghcr.io/edgecomllc/eupf:main", ["n4", ...peers.nets]);
  compose.annotate(s, "cpus", 1);
  s.environment.GIN_MODE = "release";
  s.privileged = true;
  s.sysctls["net.ipv4.conf.all.forwarding"] = 1;

  compose.setCommands(s, [
    ...compose.renameNetifs(s),
    "exec ash /app/bin/entrypoint.sh",
  ], { shell: "ash" });

  ctx.finalize.push(() => configureEupf(ctx, upf, s, peers));
}

async function configureEupf(ctx: NetDefComposeContext, upf: N.UPF, s: ComposeService, peers: netdef.UPFPeers): Promise<void> {
  const c: EUPF.Config = {
    interface_name: [],
    n3_address: "127.0.0.1",
    n9_address: "127.0.0.1",
    heartbeat_interval: 60,
    logging_level: "trace",
  };

  c.pfcp_node_id = compose.getIP(s, "n4");
  c.pfcp_address = `${c.pfcp_node_id}:8805`;
  if (peers.nets.includes("n6")) {
    c.interface_name.push("n6");
  }
  if (peers.nets.includes("n3")) {
    c.interface_name.push("n3");
    c.n3_address = compose.getIP(s, "n3");
  }
  if (peers.nets.includes("n9")) {
    c.interface_name.push("n9");
    c.n9_address = compose.getIP(s, "n9");
  }

  await ctx.writeFile(`up-cfg/${upf.name}.yaml`, c, {
    s, target: "/config.yml",
  });
}
