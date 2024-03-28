import path from "node:path";

import assert from "minimalistic-assert";
import type { ReadonlyDeep } from "type-fest";

import type { ComposeService } from "../types/mod.js";

const codebaseRoot = path.join(import.meta.dirname, "..");

/** Traffic direction. */
export enum Direction {
  dl = "DL>",
  ul = "<UL",
  bidir = "<->",
}

/** Traffic generator flow information. */
export interface TrafficGenFlowContext {
  port: number;
  dnIP: string;
  pduIP: string;
  cFlags: readonly string[];
  sFlags: readonly string[];
  dnService: ReadonlyDeep<ComposeService>;
  ueService: ReadonlyDeep<ComposeService>;
}

export interface TrafficGen {
  determineDirection: (flow: TrafficGenFlowContext) => Direction;
  nPorts: number;
  serverDockerImage: string;
  serverSetup: (s: ComposeService, flow: TrafficGenFlowContext) => void;
  clientDockerImage: string;
  clientSetup: (s: ComposeService, flow: TrafficGenFlowContext) => void;
  statsExt: string;
  statsCommands: (prefix: string) => Iterable<string>;
}

const iperf3: TrafficGen & { jsonFlag: readonly string[] } = {
  jsonFlag: ["--json"],
  determineDirection({ cFlags }) {
    return cFlags.includes("-R") ? Direction.dl : Direction.ul;
  },
  nPorts: 1,
  serverDockerImage: "networkstatic/iperf3",
  serverSetup(s, { port, dnIP, sFlags }) {
    assert(sFlags.length === 0, "iperf3 server does not accept server flags");
    s.command = [
      "--forceflush",
      ...this.jsonFlag,
      "-B", dnIP,
      "-p", `${port}`,
      "-s",
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
    yield `  $(env -C ${codebaseRoot} corepack pnpm bin)/tsx ${codebaseRoot}/trafficgen/iperf3-stats.ts ` +
      `--dir=$COMPOSE_CTX --prefix=${prefix}`;
  },
};

const iperf3t: typeof iperf3 = {
  ...iperf3,
  jsonFlag: [],
  statsExt: ".log",
  *statsCommands() {
    yield "  msg Showing final results from iperf3 text output";
    yield "  grep -w receiver ${STATS_DIR}*_c.log"; // eslint-disable-line no-template-curly-in-string
  },
};

const owamp: TrafficGen = {
  determineDirection({ cFlags }) {
    const dl = cFlags.includes("-f");
    const ul = cFlags.includes("-t");
    if (dl && ul) {
      return Direction.bidir;
    }
    if (dl) {
      return Direction.dl;
    }
    if (ul) {
      return Direction.ul;
    }
    return Direction.bidir;
  },
  nPorts: 5,
  serverDockerImage: "perfsonar/tools",
  serverSetup(s, { port, sFlags }) {
    assert(sFlags.length === 0, "owampd does not accept server flags");
    s.command = [
      "owampd",
      "-f",
      "-Z",
      "-P",
      `${port + 1}-${port + this.nPorts - 1}`,
      "-S",
      `:${port}`,
    ];
  },
  clientDockerImage: "perfsonar/tools",
  clientSetup(s, { port, dnIP, pduIP, cFlags }) {
    s.command = [
      "owping",
      "-P",
      `${port + 1}-${port + this.nPorts - 1}`,
      "-S",
      pduIP,
      ...cFlags,
      `${dnIP}:${port}`,
    ];
  },
  statsExt: ".log",
  *statsCommands() {
    yield "  msg Showing final results from owping text output";
    yield "  grep -w 'one-way delay' ${STATS_DIR}*_c.log"; // eslint-disable-line no-template-curly-in-string
  },
};

export const trafficGenerators: Record<string, TrafficGen> = {
  iperf3,
  iperf3t,
  owamp,
};
