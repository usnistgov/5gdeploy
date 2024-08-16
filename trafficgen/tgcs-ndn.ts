import type { ReadonlyDeep } from "type-fest";

import type { ComposeFile, ComposeService } from "../types/mod.js";
import { toNfdName } from "./common.js";
import { Direction, type TrafficGen } from "./tgcs-defs.js";

function connectNfdUnix(output: ComposeFile, s: ComposeService, base: ReadonlyDeep<ComposeService>): void {
  const name = toNfdName(base);
  output.volumes[name] = { name, external: true };
  s.volumes.push({
    type: "volume",
    source: name,
    target: "/run/nfd",
  });
  s.network_mode = "none";
}

export const ndnping: TrafficGen = {
  determineDirection() {
    return Direction.dl;
  },
  nPorts: 1,
  serverDockerImage: "ghcr.io/named-data/ndn-tools",
  serverPerDN: true,
  serverSetup(s, { output, prefix, sFlags, dnService }) {
    connectNfdUnix(output, s, dnService);
    s.command = [
      "ndnpingserver",
      ...sFlags,
      `/${prefix}`,
    ];
  },
  clientDockerImage: "ghcr.io/named-data/ndn-tools",
  clientSetup(s, { output, prefix, cFlags, ueService }) {
    connectNfdUnix(output, s, ueService);
    s.command = [
      "ndnping",
      ...cFlags,
      `/${prefix}`,
    ];
  },
  statsExt: ".log",
  *statsCommands() {
    yield "msg Showing ndnping final results from ndnping text output";
    yield "grep -wE 'packets transmitted|rtt min' ndnping_*-*-c.log";
  },
};
