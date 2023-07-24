import type { ComposeFile } from "../types/compose.js";
import { defineService } from "./compose.js";

export const bridgeDockerImage = "5gdeploy.localhost/bridge";

/** yargs options definition for bridge container. */
export const bridgeOptions = {
  "bridge-to": {
    desc: "bridge to list of IP addresses (comma separated)",
    type: "string",
  },
  "bridge-on": {
    desc: "bridge specified networks only (comma separated)",
    defaultDescription: "all networks except 'mgmt'",
    type: "string",
  },
} as const;

/**
 * Define a bridge container.
 * @param c Compose file.
 * @param bridgeTo list of host IP addresses that the bridge should reach (comma separated).
 * @param bridgeOn list of Docker networks that should be bridged (comma separated).
 */
export function defineBridge(c: ComposeFile, bridgeTo: string, bridgeOn: string | undefined): void {
  const on = bridgeOn ? new Set(bridgeOn.split(",")) : new Set();
  const bridges = Object.keys(c.networks)
    .map((net) => net.replace(/^br-/, ""))
    .filter((net) => on.size === 0 ? net !== "mgmt" : on.has(net))
    .sort((a, b) => a.localeCompare(b));
  const service = defineService(c, "bridge", bridgeDockerImage);
  service.network_mode = "host";
  service.cap_add.push("NET_ADMIN");
  service.command = ["/entrypoint.sh", bridges.join(","), bridgeTo];
}
