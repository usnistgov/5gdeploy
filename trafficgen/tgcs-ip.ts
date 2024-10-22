import path from "node:path";

import * as shlex from "shlex";

import * as compose from "../compose/mod.js";
import { assert, codebaseRoot } from "../util/mod.js";
import { ClientStartOpt, Direction, extractHashFlag, mountOutputVolume, rewriteOutputFlag, type TrafficGen } from "./tgcs-defs.js";

export const iperf2: TrafficGen & { csvFlag: readonly string[] } = {
  csvFlag: [],
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
  dockerImage: "mlabbe/iperf:2.1.9-r0",
  serverSetup(s, { port, sIP, cFlags, sFlags }) {
    assert(cFlags.includes("-u") === sFlags.includes("-u"), "iperf2 client and server must be both in UDP mode or both in TCP mode");
    s.command = [
      "--utc",
      ...this.csvFlag,
      "-B", sIP,
      "-p", `${port}`,
      "-s",
      ...sFlags,
    ];
    s.healthcheck = { disable: true };
  },
  clientSetup(s, { port, sIP, cIP, cFlags }) {
    s.command = [
      "--utc",
      ...this.csvFlag,
      "-B", cIP,
      "-p", `${port}`,
      "-c", sIP,
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

export const iperf2csv: typeof iperf2 = {
  ...iperf2,
  csvFlag: ["-yC"],
  dockerImage: "5gdeploy.localhost/iperf2",
  statsExt: ".csv",
  statsCommands: undefined,
};

export const iperf3: TrafficGen & { jsonFlag: readonly string[] } = {
  jsonFlag: ["--json"],
  determineDirection({ cFlags }) {
    return cFlags.includes("--bidir") ? Direction.bidir :
      cFlags.includes("-R") ? Direction.dl : Direction.ul;
  },
  nPorts: 1,
  dockerImage: "perfsonar/tools",
  serverSetup(s, { port, sIP, sFlags }) {
    assert(sFlags.length === 0, "iperf3 server does not accept server flags");
    s.command = [
      "iperf3",
      "--forceflush",
      ...this.jsonFlag,
      "-B", sIP,
      "-p", `${port}`,
      "-s",
    ];
  },
  clientSetup(s, { port, sIP, cIP, cFlags }) {
    const start = new ClientStartOpt(s);
    cFlags = start.rewriteFlag(cFlags);
    compose.setCommands(s, [
      ...start.waitCommands(),
      shlex.join([
        "iperf3",
        "--forceflush",
        ...this.jsonFlag,
        "-B", cIP,
        "-p", `${port}`,
        "-c", sIP,
        ...cFlags,
      ]),
    ], { withScriptHead: false });
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
  dockerImage: "perfsonar/tools",
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
  clientBin: "owping",
  clientSetup(s, { prefix, group, port, sIP, cIP, cFlags }) {
    const start = new ClientStartOpt(s);
    cFlags = start.rewriteFlag(cFlags);
    cFlags = rewriteOutputFlag(s, prefix, group, port, cFlags, /^-([FT])$/, this.outputExt);
    compose.setCommands(s, [
      ...start.waitCommands(),
      shlex.join([
        this.clientBin,
        "-P", `${port + 1}-${port + this.nPorts - 1}`,
        "-S", cIP,
        ...cFlags,
        `${sIP}:${port}`,
      ]),
    ], { withScriptHead: false });
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
  dockerImage: "alectolytic/netperf",
  serverSetup(s, { port, sIP, sFlags }) {
    s.command = [
      "netserver",
      "-D",
      "-L", `${sIP},inet`,
      "-p", `${port}`,
      ...sFlags,
    ];
  },
  clientSetup(s, { port, sIP, cIP, cFlags }) {
    const start = new ClientStartOpt(s);
    cFlags = start.rewriteFlag(cFlags);
    compose.setCommands(s, [
      ...start.waitCommands(),
      shlex.join([
        "netperf",
        "-H", `${sIP},inet`,
        "-L", `${cIP},inet`,
        "-p", `${port},${port + 1}`,
        ...cFlags,
      ]),
    ], { shell: "ash", withScriptHead: false });
  },
  statsExt: ".log",
};

export const sockperf: TrafficGen = {
  determineDirection({ cFlags }) {
    if (cFlags.includes("server")) {
      return Direction.dl;
    }
    return Direction.ul;
  },
  nPorts: 1,
  dockerImage: "5gdeploy.localhost/sockperf",
  serverSetup(s, { port, sIP, sFlags }) {
    s.command = [
      "sockperf", "server",
      "-i", sIP,
      "-p", `${port}`,
      ...sFlags,
    ];
  },
  clientSetup(s, { prefix, group, port, sIP, cIP, cFlags }) {
    const start = new ClientStartOpt(s);
    cFlags = start.rewriteFlag(cFlags);
    cFlags = rewriteOutputFlag(s, prefix, group, port, cFlags, /^--(full-log)$/, ".csv");

    const ipFlags = [
      "-i", sIP,
      "-p", `${port}`,
      "--client_ip", cIP,
      "--client_port", `${port}`,
    ];
    const ipCommands: string[] = [];

    if (["playback", "pb"].includes(cFlags[0]!)) {
      ipFlags.splice(4, 4);
      ipCommands.push(`ip -j route get ${sIP} from ${cIP} | jq -r${
        " "}'.[] | ["ip","route","replace",.dst] + if .gateway then ["via",.gateway] else ["dev",.dev] end | @sh' | sh`);
      s.cap_add.push("NET_ADMIN");

      const dfIndex = cFlags.indexOf("--data-file");
      assert(dfIndex >= 0 && dfIndex < cFlags.length - 1, "sockperf playback --data-file missing");
      const dataFile = cFlags[dfIndex + 1]!;
      assert(path.isAbsolute(dataFile), "sockperf playback --data-file must have absolute path");
      s.volumes.push({
        type: "bind",
        source: dataFile,
        target: dataFile,
        read_only: true,
      });
    }

    compose.setCommands(s, [
      ...ipCommands,
      ...start.waitCommands(),
      shlex.join(["sockperf", ...cFlags.toSpliced(1, 0, ...ipFlags)]),
    ], { withScriptHead: false });
    compose.annotate(s, "cpus", 2);
  },
  statsExt: ".log",
  *statsCommands() {
    yield "msg Showing sockperf final results";
    yield "for F in sockperf_*.log; do";
    yield `  echo $F $(grep ${shlex.join([
      "-Fe", "Summary: Message Rate is", // throughput
      "-Fe", "[Valid Duration]", // ping-pong, playback
      "-Fe", "Total Dropped/OOO", // server -g
    ])} $F | tail -1 | sed 's|^sockperf: ||')`;
    yield "done";
  },
};

export const itg: TrafficGen = {
  determineDirection() {
    return Direction.ul;
  },
  nPorts: 40,
  dockerImage: "jjq52021/ditg",
  serverSetup(s, { prefix, port, sNetif }) {
    compose.setCommands(s, [
      "msg Starting ITGRecv",
      shlex.join([
        "ITGRecv",
        "-Sp", `${port}`,
        "-Si", "mgmt",
        "-i", sNetif,
      ]),
    ]);
    mountOutputVolume(s, prefix);
    compose.annotate(s, "tgcs_docker_timestamps", 1);
  },
  clientSetup(s, { prefix, group, port, cService, cIP, cFlags, sService, sIP }) {
    const start = new ClientStartOpt(s);
    cFlags = start.rewriteFlag(cFlags);

    let nFlows: RegExpMatchArray | undefined | number;
    [cFlags, nFlows] = extractHashFlag(cFlags, /^#f=(\d+)$/);
    nFlows = nFlows ? Number.parseInt(nFlows[1]!, 10) : 1;
    assert(nFlows >= 1 && nFlows < 40, "#f must be between 1 and 39");

    const ipFlags = [
      "-Sda", compose.getIP(sService, "mgmt"),
      "-Ssa", compose.getIP(cService, "mgmt"),
      "-a", `::ffff:${sIP}`,
      "-sa", `::ffff:${cIP}`,
    ];
    const flows: string[] = [];
    for (let i = 1; i <= nFlows; ++i) {
      flows.push(shlex.join([
        ...ipFlags,
        "-Sdp", `${port}`,
        "-rp", `${port + i}`,
        "-sp", `${port + i}`,
        ...cFlags,
      ]));
    }

    compose.setCommands(s, [
      "msg Creating multi-flow script",
      `echo ${shlex.quote(flows.join("\n"))} | tee /multi-flow.txt`,
      ...start.waitCommands(),
      "msg Starting ITGSend",
      shlex.join([
        "ITGSend",
        "/multi-flow.txt",
        "-l", `/output/${group}-${port}-c.itg`,
        "-x", `/output/${group}-${port}-s.itg`,
      ]),
    ]);
    mountOutputVolume(s, prefix);
    compose.annotate(s, "cpus", 2);
    compose.annotate(s, "tgcs_docker_timestamps", 1);
  },
  statsExt: ".log",
};
