import path from "node:path";

import assert from "minimalistic-assert";
import * as shlex from "shlex";
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
  prefix: string;
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
    return cFlags.includes("--bidir") ? Direction.bidir :
      cFlags.includes("-R") ? Direction.dl : Direction.ul;
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
      ...(cFlags.includes("--bidir") ? [] : ["--cport", `${port}`]),
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

const owamp: TrafficGen & {
  serverBin: string;
  clientBin: string;
  outputExt: string;
  statsGrep: string;
} = {
  determineDirection({ cFlags }) {
    const dl = cFlags.includes("-f") || cFlags.includes("-F");
    const ul = cFlags.includes("-t") || cFlags.includes("-T");
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
  serverBin: "owampd",
  serverSetup(s, { port, sFlags }) {
    assert(sFlags.length === 0, `${this.serverBin} does not accept server flags`);
    s.command = [
      this.serverBin,
      "-f",
      "-Z",
      "-P",
      `${port + 1}-${port + this.nPorts - 1}`,
      "-S",
      `:${port}`,
    ];
  },
  clientDockerImage: "perfsonar/tools",
  clientBin: "owping",
  clientSetup(s, { prefix, port, dnIP, pduIP, cFlags }) {
    let hasOutput = false;
    s.command = [
      this.clientBin,
      "-P",
      `${port + 1}-${port + this.nPorts - 1}`,
      "-S",
      pduIP,
      ...cFlags.map((flag, i) => {
        if (i > 0 && /^-[FT]$/.test(cFlags[i - 1]!)) {
          hasOutput = true;
          return `/output/${port}${cFlags[i - 1]}${this.outputExt}`;
        }
        return flag;
      }),
      `${dnIP}:${port}`,
    ];
    if (hasOutput) {
      s.volumes.push({
        type: "bind",
        source: `./${prefix}`,
        target: "/output",
      });
    }
  },
  outputExt: ".owp",
  statsExt: ".log",
  statsGrep: "one-way (delay|jitter)",
  *statsCommands() {
    yield `  msg Showing final results from ${this.clientBin} text output`;
    yield `  grep -wE ${shlex.quote(this.statsGrep)} $\{STATS_DIR}*_c.log`;
  },
};

const twamp: typeof owamp = {
  ...owamp,
  determineDirection() {
    return Direction.bidir;
  },
  serverBin: "twampd",
  clientBin: "twping",
  outputExt: ".twp",
  statsGrep: "round-trip time|two-way jitter",
};

const netperf: TrafficGen = {
  determineDirection() {
    return Direction.bidir;
  },
  nPorts: 2,
  serverDockerImage: "alectolytic/netperf",
  serverSetup(s, { port, dnIP, sFlags }) {
    s.command = [
      "netserver",
      "-D",
      "-L", `${dnIP},inet`,
      "-p", `${port}`,
      ...sFlags,
    ];
  },
  clientDockerImage: "alectolytic/netperf",
  clientSetup(s, { port, dnIP, pduIP, cFlags }) {
    s.command = [
      "netperf",
      "-H", `${dnIP},inet`,
      "-L", `${pduIP},inet`,
      "-p", `${port},${port + 1}`,
      ...cFlags,
    ];
  },
  statsExt: ".log",
  *statsCommands() {
    yield "  :";
  },
};

export const trafficGenerators: Record<string, TrafficGen> = {
  iperf3,
  iperf3t,
  owamp,
  twamp,
  netperf,
};
