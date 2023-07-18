import path from "node:path";

import { updateService } from "../phoenix-compose/compose.js";
import { applyNetdef, ScenarioFolder } from "../phoenix-config/mod.js";
import type { NetDefComposeContext } from "./context.js";
import { env } from "./env.js";

export async function phoenixCore(ctx: NetDefComposeContext): Promise<void> {
  const sf = await ScenarioFolder.load(path.resolve(env.D5G_PHOENIX_CFG, "5g"));
  applyNetdef(sf, ctx.netdef);

  for (const net of sf.ipmap.networks.keys()) {
    ctx.defineNetwork(net, net === "mgmt");
  }
  for (const [ct, netifs] of sf.ipmap.containers) {
    const s = ctx.defineService(ct, "5gdeploy.localhost/phoenix", Array.from(netifs.keys()));
    for (const [net, netif] of Object.entries(s.networks)) {
      (netifs as Map<string, string>).set(net, netif.ipv4_address);
    }
    updateService(s);
  }

  await sf.save(path.resolve(ctx.out, "cfg"), path.resolve(ctx.out, "sql"));
}

export async function phoenixRAN(ctx: NetDefComposeContext): Promise<void> {
  void ctx;
}
