import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import type { Options as YargsOptions } from "yargs";

import type { ComposeFile } from "../types/compose.js";
import { defineService } from "./compose.js";

export const bridgeDockerImage = "5gdeploy.localhost/bridge";

/** yargs options definition for bridge container. */
export const bridgeOptions = {
  bridge: {
    desc: "bridge a network to list of IP addresses",
    nargs: 1,
    string: true,
    type: "array",
  },
} as const satisfies Record<string, YargsOptions>;

/**
 * Define a bridge container.
 * @param c Compose file.
 * @param bridgeTo list of host IP addresses that the bridge should reach (comma separated).
 * @param bridgeOn list of Docker networks that should be bridged (comma separated).
 */
export function defineBridge(c: ComposeFile, bridgeArgs: readonly string[]): void {
  for (const a of bridgeArgs) {
    const tokens = a.split(",");
    assert(tokens.length >= 4, "bridge must have at least 2 hosts");
    const network = tokens.shift()!;
    const mode = tokens.shift()!;
    assert(c.networks[network], `unknown network ${network}`);
    assert(mode === "vx", `unknown mode ${mode}`);
    for (const ip of tokens) {
      new Netmask(ip, "32"); // eslint-disable-line no-new
    }
  }

  const service = defineService(c, "bridge", bridgeDockerImage);
  service.network_mode = "host";
  service.cap_add.push("NET_ADMIN");
  service.command = ["/entrypoint.sh", bridgeArgs.join(" ")];
}
