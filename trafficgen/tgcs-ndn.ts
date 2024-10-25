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
  dockerImage: "ghcr.io/named-data/ndn-tools",
  serverPerDN: true,
  serverSetup(s, { output, prefix, sService, sFlags }) {
    connectNfdUnix(output, s, sService);
    s.command = [
      "ndnpingserver",
      ...sFlags,
      `/${prefix}`,
    ];
  },
  clientSetup(s, { output, prefix, cService, cFlags }) {
    connectNfdUnix(output, s, cService);
    s.command = [
      "ndnping",
      ...cFlags,
      `/${prefix}`,
    ];
  },
  *statsCommands() {
    yield "msg Showing ndnping final results from ndnping text output";
    yield "grep -wE 'packets transmitted|rtt min' ndnping_*-*-c.log";
  },
};
