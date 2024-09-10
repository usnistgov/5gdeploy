import * as shlex from "shlex";

import * as compose from "../compose/mod.js";
import { assert, codebaseRoot } from "../util/mod.js";
import { ClientStartOpt, Direction, rewriteOutputFlag, type TrafficGen } from "./tgcs-defs.js";

export const iperf2: TrafficGen = {
  determineDirection({ cFlags }) {
    for (const [flag, dir] of Object.entries<Direction>({
      "-d": Direction.bidir,
      "--dualtest": Direction.bidir,
      "-r": Direction.bidir,
      "--tradeoff": Direction.bidir,
      "--full-duplex": Direction.bidir,
      "-R": Direction.dl,
      "--reverse": Direction.dl,
    })) {
      if (cFlags.includes(flag)) {
        return dir;
      }
    }
    return Direction.ul;
  },
  nPorts: 1,
  serverDockerImage: "mlabbe/iperf:2.1.9-r0",
  serverSetup(s, { port, dnIP, cFlags, sFlags }) {
    assert(cFlags.includes("-u") === sFlags.includes("-u"), "iperf2 client and server must be both in UDP mode or both in TCP mode");
    s.command = [
      "--utc",
      "-B", dnIP,
      "-p", `${port}`,
      "-s",
      ...sFlags,
    ];
    s.healthcheck = { disable: true };
  },
  clientDockerImage: "mlabbe/iperf:2.1.9-r0",
  clientSetup(s, { port, dnIP, pduIP, cFlags }) {
    s.command = [
      "--utc",
      "-B", pduIP,
      "-p", `${port}`,
      "-c", dnIP,
      ...cFlags,
    ];
    s.healthcheck = { disable: true };
  },
  statsExt: ".log",
  *statsCommands() {
    yield "msg Showing iperf2 final results from iperf2 text output";
    yield `awk -f ${codebaseRoot}/trafficgen/iperf2-stats.awk iperf2_*.log`;
  },
};

export const iperf3: TrafficGen & { jsonFlag: readonly string[] } = {
  jsonFlag: ["--json"],
  determineDirection({ cFlags }) {
    return cFlags.includes("--bidir") ? Direction.bidir :
      cFlags.includes("-R") ? Direction.dl : Direction.ul;
  },
  nPorts: 1,
  serverDockerImage: "perfsonar/tools",
  serverSetup(s, { port, dnIP, sFlags }) {
    assert(sFlags.length === 0, "iperf3 server does not accept server flags");
    s.command = [
      "iperf3",
      "--forceflush",
      ...this.jsonFlag,
      "-B", dnIP,
      "-p", `${port}`,
      "-s",
    ];
  },
  clientDockerImage: "perfsonar/tools",
  clientSetup(s, { port, dnIP, pduIP, cFlags }) {
    const start = new ClientStartOpt(s);
    cFlags = start.rewriteFlag(cFlags);
    compose.setCommands(s, [
      ...start.waitCommands(),
      shlex.join([
        "iperf3",
        "--forceflush",
        ...this.jsonFlag,
        "-B", pduIP,
        "-p", `${port}`,
        "-c", dnIP,
        ...cFlags,
      ]),
    ]);
  },
  statsExt: ".json",
  *statsCommands(prefix) {
    yield `msg Gathering iperf3 statistics table to ${prefix}/iperf3.tsv`;
    yield `$(env -C ${codebaseRoot} corepack pnpm bin)/tsx ${codebaseRoot}/trafficgen/iperf3-stats.ts ` +
      `--dir=$COMPOSE_CTX --prefix=${prefix}`;
  },
};

export const iperf3t: typeof iperf3 = {
  ...iperf3,
  jsonFlag: [],
  statsExt: ".log",
  *statsCommands() {
    yield "msg Showing iperf3 final results from iperf3 text output";
    yield "grep -w receiver iperf3t_*-*-c.log";
  },
};

export const owamp: TrafficGen & {
  tgid: string;
  serverBin: string;
  clientBin: string;
  outputExt: string;
  statsGrep: string;
} = {
  tgid: "owamp",
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
  clientSetup(s, { prefix, group, port, dnIP, pduIP, cFlags }) {
    const start = new ClientStartOpt(s);
    cFlags = start.rewriteFlag(cFlags);
    cFlags = rewriteOutputFlag(s, prefix, group, port, cFlags, /^-([FT])$/, this.outputExt);
    compose.setCommands(s, [
      ...start.waitCommands(),
      shlex.join([
        this.clientBin,
        "-P", `${port + 1}-${port + this.nPorts - 1}`,
        "-S", pduIP,
        ...cFlags,
        `${dnIP}:${port}`,
      ]),
    ]);
  },
  outputExt: ".owp",
  statsExt: ".log",
  statsGrep: "one-way (delay|jitter)",
  *statsCommands() {
    yield `msg Showing ${this.tgid} final results from ${this.clientBin} text output`;
    yield `grep -wE ${shlex.quote(this.statsGrep)} ${this.tgid}_*-*-c.log`;
  },
};

export const twamp: typeof owamp = {
  ...owamp,
  tgid: "twamp",
  determineDirection() {
    return Direction.bidir;
  },
  serverBin: "twampd",
  clientBin: "twping",
  outputExt: ".twp",
  statsGrep: "round-trip time|two-way jitter",
};

export const netperf: TrafficGen = {
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

export const sockperf: TrafficGen = {
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
  clientSetup(s, { prefix, group, port, dnIP, pduIP, cFlags }) {
    cFlags = rewriteOutputFlag(s, prefix, group, port, cFlags, /^--(full-log)$/, ".csv");
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
