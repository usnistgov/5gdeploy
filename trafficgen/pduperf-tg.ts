import path from "node:path";

import * as shlex from "shlex";
import assert from "tiny-invariant";
import type { ReadonlyDeep } from "type-fest";

import type { ComposeFile, ComposeService } from "../types/mod.js";

const codebaseRoot = path.join(import.meta.dirname, "..");

/** Traffic direction. */
export enum Direction {
  dl = "DL>",
  ul = "<UL",
  bidir = "<->",
}

/** Traffic generator flow information. */
export interface TrafficGenFlowContext {
  c: ComposeFile;
  output: ComposeFile;
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
  serverPerDN?: boolean;
  serverSetup: (s: ComposeService, flow: TrafficGenFlowContext) => void;
  clientDockerImage: string;
  clientSetup: (s: ComposeService, flow: TrafficGenFlowContext) => void;
  statsExt: string;
  statsCommands?: (prefix: string) => Iterable<string>;
}

function rewriteOutputFlag(s: ComposeService, prefix: string, port: number, flags: readonly string[], re: RegExp, ext: string): string[] {
  let hasOutput = false;
  const rFlags = flags.map((flag, i) => {
    const m = flags[i - 1]?.match(re);
    if (!m) {
      return flag;
    }
    hasOutput = true;
    return `/output/${port}-${m[1]}${ext}`;
  });

  if (hasOutput) {
    s.volumes.push({
      type: "bind",
      source: `./${prefix}`,
      target: "/output",
    });
  }
  return rFlags;
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
    yield `msg Gathering iperf3 statistics table to ${prefix}.tsv`;
    yield `cd ${path.join(import.meta.dirname, "..")}`;
    yield `$(env -C ${codebaseRoot} corepack pnpm bin)/tsx ${codebaseRoot}/trafficgen/iperf3-stats.ts ` +
      `--dir=$COMPOSE_CTX --prefix=${prefix}`;
  },
};

const iperf3t: typeof iperf3 = {
  ...iperf3,
  jsonFlag: [],
  statsExt: ".log",
  *statsCommands() {
    yield "msg Showing final results from iperf3 text output";
    yield "grep -w receiver *_c.log";
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
      "-P", `${port + 1}-${port + this.nPorts - 1}`,
      "-S", `:${port}`,
    ];
  },
  clientDockerImage: "perfsonar/tools",
  clientBin: "owping",
  clientSetup(s, { prefix, port, dnIP, pduIP, cFlags }) {
    cFlags = rewriteOutputFlag(s, prefix, port, cFlags, /^-([FT])$/, this.outputExt);
    s.command = [
      this.clientBin,
      "-P", `${port + 1}-${port + this.nPorts - 1}`,
      "-S", pduIP,
      ...cFlags,
      `${dnIP}:${port}`,
    ];
  },
  outputExt: ".owp",
  statsExt: ".log",
  statsGrep: "one-way (delay|jitter)",
  *statsCommands() {
    yield `msg Showing final results from ${this.clientBin} text output`;
    yield `grep -wE ${shlex.quote(this.statsGrep)} *_c.log`;
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
};

const sockperf: TrafficGen = {
  determineDirection() {
    return Direction.bidir;
  },
  nPorts: 1,
  serverDockerImage: "pazaan/sockperf",
  serverSetup(s, { port, dnIP, sFlags }) {
    s.command = [
      "server",
      "-i", dnIP,
      "-p", `${port}`,
      ...sFlags,
    ];
  },
  clientDockerImage: "pazaan/sockperf",
  clientSetup(s, { prefix, port, dnIP, pduIP, cFlags }) {
    cFlags = rewriteOutputFlag(s, prefix, port, cFlags, /^--(full-log)$/, ".csv");
    s.command = [
      ...cFlags,
      "-i", dnIP,
      "-p", `${port}`,
      "--client_ip", pduIP,
      "--client_port", `${port}`,
    ];
  },
  statsExt: ".log",
};

const ndnping: TrafficGen = {
  determineDirection() {
    return Direction.dl;
  },
  nPorts: 1,
  serverDockerImage: "ghcr.io/named-data/ndn-tools",
  serverPerDN: true,
  serverSetup(s, { prefix, sFlags }) {
    s.environment.NDN_CLIENT_TRANSPORT = "tcp://127.0.0.1";
    s.command = [
      "ndnpingserver",
      ...sFlags,
      `/${prefix}`,
    ];
  },
  clientDockerImage: "ghcr.io/named-data/ndn-tools",
  clientSetup(s, { prefix, cFlags }) {
    s.environment.NDN_CLIENT_TRANSPORT = "tcp://127.0.0.1";
    s.command = [
      "ndnping",
      ...cFlags,
      `/${prefix}`,
    ];
  },
  statsExt: ".log",
  *statsCommands() {
    yield "msg Showing final results from ndnping text output";
    yield "grep -wE 'packets transmitted|rtt min' *_c.log";
  },
};

export const trafficGenerators: Record<string, TrafficGen> = {
  iperf3,
  iperf3t,
  owamp,
  twamp,
  netperf,
  sockperf,
  ndnping,
};
