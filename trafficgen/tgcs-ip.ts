import path from "node:path";

import * as shlex from "shlex";

import * as compose from "../compose/mod.js";
import type { ComposeService } from "../types/mod.js";
import { assert, codebaseRoot, tsrun } from "../util/mod.js";
import { ClientStartOpt, Direction, extractHashFlag, mountOutputVolume, rewriteOutputFlag, type TrafficGen } from "./tgcs-defs.js";

function handleTextOutputFlag(
    s: ComposeService, flags: readonly string[], nonTextStatsExt: string,
): [rflags: string[], wantText: boolean] {
  const [rflags, wantText] = extractHashFlag(flags, /^#text$/);
  if (!wantText) {
    compose.annotate(s, "tgcs_stats_ext", nonTextStatsExt);
  }
  return [rflags, !!wantText];
}

function* iperfStats(prefix: string): Iterable<string> {
  yield "if [[ ${HAVE_IPERF_STATS:-0} -eq 0 ]]; then"; // eslint-disable-line no-template-curly-in-string
  yield "  HAVE_IPERF_STATS=1";
  yield `  msg Gathering iperf2/iperf3 statistics table to ${prefix}/iperf.tsv`;
  yield `  ${tsrun("trafficgen/iperf-stats.ts")} --dir=$COMPOSE_CTX --prefix=${prefix}`;
  yield "fi";
}

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
  dockerImage: "5gdeploy.localhost/iperf2",
  serverSetup(s, { port, sIP, cFlags, sFlags }) {
    assert(cFlags.includes("-u") === sFlags.includes("-u"), "iperf2 client and server must both use UDP traffic or both use TCP traffic");
    const [, wantText] = handleTextOutputFlag(s, cFlags, ".csv");
    s.command = [
      ...(wantText ? [] : ["-yC"]),
      "-e",
      "--utc",
      "-B", sIP,
      "-p", `${port}`,
      "-s",
      ...sFlags,
    ];
  },
  clientSetup(s, { port, sIP, cIP, cFlags }) {
    let wantText: boolean;
    [cFlags, wantText] = handleTextOutputFlag(s, cFlags, ".csv");
    s.command = [
      ...(wantText ? [] : ["-yC"]),
      "-e",
      "--utc",
      "-B", cIP,
      "-p", `${port}`,
      "-c", sIP,
      ...cFlags,
    ];
  },
  *statsCommands(prefix) {
    yield* iperfStats(prefix);
    yield "msg Showing iperf2 final results from iperf2 text output";
    yield `find -name 'iperf2_*.log' | xargs -r awk -f ${codebaseRoot}/trafficgen/iperf2-stats.awk`;
  },
};

export const iperf3: TrafficGen = {
  determineDirection({ cFlags }) {
    return cFlags.includes("--bidir") ? Direction.bidir :
      cFlags.includes("-R") ? Direction.dl : Direction.ul;
  },
  dockerImage: "perfsonar/tools",
  serverSetup(s, { port, sIP, cFlags, sFlags }) {
    assert(sFlags.length === 0, "iperf3 server does not accept server flags");
    const [, wantText] = handleTextOutputFlag(s, cFlags, ".json");

    s.command = [
      "iperf3",
      ...(wantText ? [] : ["--json"]),
      "--forceflush",
      "-B", sIP,
      "-p", `${port}`,
      "-s",
    ];
  },
  clientSetup(s, { port, sIP, cIP, cFlags }) {
    let wantText: boolean;
    [cFlags, wantText] = handleTextOutputFlag(s, cFlags, ".json");
    const start = new ClientStartOpt(s);
    cFlags = start.rewriteFlag(cFlags);

    compose.setCommands(s, [
      ...start.waitCommands(),
      shlex.join([
        "iperf3",
        ...(wantText ? [] : ["--json"]),
        "--forceflush",
        "-B", cIP,
        "-p", `${port}`,
        "-c", sIP,
        ...cFlags,
      ]),
    ], { withScriptHead: false });
  },
  *statsCommands(prefix) {
    yield* iperfStats(prefix);
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
  dockerImage: "perfsonar/tools",
  serverBin: "owampd",
  serverSetup(s, flow) {
    flow.nPorts = 5;
    const { port, nPorts, sFlags } = flow;
    assert(sFlags.length === 0, `${this.serverBin} does not accept server flags`);
    s.command = [
      this.serverBin,
      "-f",
      "-Z",
      "-P", `${port + 1}-${port + nPorts - 1}`,
      "-S", `:${port}`,
    ];
  },
  clientBin: "owping",
  clientSetup(s, { prefix, group, port, nPorts, sIP, cIP, cFlags }) {
    const start = new ClientStartOpt(s);
    cFlags = start.rewriteFlag(cFlags);
    cFlags = rewriteOutputFlag(s, prefix, group, port, cFlags, /^-([FT])$/, this.outputExt);
    compose.setCommands(s, [
      ...start.waitCommands(),
      shlex.join([
        this.clientBin,
        "-P", `${port + 1}-${port + nPorts - 1}`,
        "-S", cIP,
        ...cFlags,
        `${sIP}:${port}`,
      ]),
    ], { withScriptHead: false });
  },
  outputExt: ".owp",
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
  clientSetup(s, flow) {
    let { port, sIP, cIP, cFlags } = flow;
    flow.nPorts = 2;

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
};

export const sockperf: TrafficGen = {
  determineDirection() {
    return Direction.ul;
  },
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
      ipFlags.splice(4, 4); // https://github.com/Mellanox/sockperf/issues/234
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
  name: "D-ITG",
  determineDirection() {
    return Direction.ul;
  },
  dockerImage: "jjq52021/ditg",
  serverSetup(s, { prefix, port, sNetif }) {
    s.entrypoint = [];
    s.command = [
      "ITGRecv",
      "-Sp", `${port}`,
      "-Si", "mgmt",
      "-i", sNetif,
    ];
    mountOutputVolume(s, prefix);
    compose.annotate(s, "tgcs_docker_timestamps", 1);
    compose.annotate(s, "tgcs_docker_logerr", 1);
  },
  clientSetup(s, flow) {
    let { prefix, group, port, cService, cIP, cFlags, sService, sIP } = flow;
    const start = new ClientStartOpt(s);
    cFlags = start.rewriteFlag(cFlags);

    let nFlows: extractHashFlag.Match | number;
    [cFlags, nFlows] = extractHashFlag(cFlags, /^#flows=(\d+)$/);
    nFlows = nFlows ? Number.parseInt(nFlows[1]!, 10) : 1;
    flow.nPorts = nFlows + 1;

    const ipFlags = [
      "-Sda", compose.getIP(sService, "mgmt"),
      "-Sdp", `${port}`,
      "-Ssa", compose.getIP(cService, "mgmt"),
      "-a", `::ffff:${sIP}`,
      "-sa", `::ffff:${cIP}`,
    ];
    const flows: string[] = [];
    for (let i = 1; i <= nFlows; ++i) {
      flows.push(shlex.join([
        ...ipFlags,
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
    compose.annotate(s, "tgcs_docker_timestamps", 1);
  },
};
