import path from "node:path";

import { type Minimatch } from "minimatch";
import * as shlex from "shlex";

import type { ComposeService } from "../types/mod.js";

export enum Direction {
  DL = "DL>",
  UL = "UL<",
}

export interface FlowSelector {
  dnPattern: Minimatch;
  uePattern: Minimatch;
  cFlags: readonly string[];
  sFlags: readonly string[];
}

export interface FlowInfo extends Pick<FlowSelector, "cFlags" | "sFlags"> {
  port: number;
  dnIP: string;
  pduIP: string;
}

export interface TrafficGen {
  determineDirection: (flow: FlowInfo) => Direction;
  serverDockerImage: string;
  serverSetup: (s: ComposeService, flow: FlowInfo) => void;
  clientDockerImage: string;
  clientSetup: (s: ComposeService, flow: FlowInfo) => void;
  statsExt: string;
  statsCommands: (prefix: string) => Iterable<string>;
}

const iperf3: TrafficGen & { jsonFlag: readonly string[] } = {
  jsonFlag: ["--json"],
  determineDirection({ cFlags }) {
    return cFlags.includes("-R") ? Direction.DL : Direction.UL;
  },
  serverDockerImage: "networkstatic/iperf3",
  serverSetup(s, { port, dnIP, sFlags }) {
    s.command = [
      "--forceflush",
      ...this.jsonFlag,
      "-B", dnIP,
      "-p", `${port}`,
      "-s",
      ...sFlags,
    ];
  },
  clientDockerImage: "networkstatic/iperf3",
  clientSetup(s, { port, dnIP, pduIP, cFlags }) {
    s.command = [
      "--forceflush",
      ...this.jsonFlag,
      "-B", pduIP,
      "-p", `${port}`,
      "--cport", `${port}`,
      "-c", dnIP,
      ...cFlags,
    ];
  },
  statsExt: ".json",
  *statsCommands(prefix) {
    yield `  msg Gathering iperf3 statistics table to ${prefix}.tsv`;
    yield `  cd ${path.join(import.meta.dirname, "..")}`;
    yield `  $(corepack pnpm bin)/tsx trafficgen/iperf3-stats.ts --dir=$COMPOSE_CTX --prefix=${shlex.quote(prefix)}`;
  },
};

const iperf3t: typeof iperf3 = {
  ...iperf3,
  jsonFlag: [],
  statsExt: ".log",
  *statsCommands(prefix) {
    yield "  msg Showing final results from iperf3 text output";
    yield `  grep -w receiver ${prefix}/*_c.log`;
  },
};

export const trafficGenerators: Record<string, TrafficGen> = {
  iperf3,
  iperf3t,
};
