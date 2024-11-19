import path from "node:path";

import { Minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import oblMap from "obliterator/map.js";
import * as shlex from "shlex";
import { sortBy } from "sort-by-typescript";
import { collect, flatMap, pipeline } from "streaming-iterables";

import * as compose from "../compose/mod.js";
import type { ComposeService } from "../types/mod.js";
import { assert, cmdOutput, file_io, splitVbar, tsrun, Yargs, YargsFloatNonNegative, type YargsOpt } from "../util/mod.js";
import { copyPlacementNetns, ctxOptions, gatherPduSessions, loadCtx } from "./common.js";
import { Direction, extractHashFlag, type TrafficGen, type TrafficGenFlowContext } from "./tgcs-defs.js";
import * as tg_ip from "./tgcs-ip.js";
import * as tg_ndn from "./tgcs-ndn.js";
import * as tg_ns3 from "./tgcs-ns3.js";

const trafficGenerators = {
  ...tg_ip,
  ...tg_ns3,
  ...tg_ndn,
} satisfies Record<string, TrafficGen>;

function makeOption(tgid: string) {
  return {
    array: true,
    coerce(lines: readonly string[]): Array<{
      dnPattern: Minimatch;
      uePattern: Minimatch;
    } & Pick<TrafficGenFlowContext, "cFlags" | "sFlags">> {
      return Array.from(lines, (line) => {
        const tokens = splitVbar(tgid, line, 2, 4);
        return {
          dnPattern: new Minimatch(tokens[0]),
          uePattern: new Minimatch(tokens[1]),
          cFlags: shlex.split(tokens[2] ?? ""),
          sFlags: shlex.split(tokens[3] ?? ""),
        };
      });
    },
    desc: `define ${trafficGenerators[tgid as keyof typeof trafficGenerators].name ?? tgid} flows`,
    group: "Flow Definitions:",
    nargs: 1,
    type: "string",
  } as const satisfies YargsOpt;
}

const args = Yargs()
  .option(ctxOptions)
  .option("prefix", {
    default: "tg",
    desc: "container name prefix",
    type: "string",
  })
  .option("port", {
    default: 20000,
    desc: "starting port number",
    type: "number",
  })
  .option("ports-per-flow", {
    desc: "how many ports allocated to each flow",
    type: "number",
  })
  .option("startup-delay", {
    default: 5,
    desc: "sleep duration (seconds) between starting servers and starting clients",
    ...YargsFloatNonNegative,
  })
  .option("t0-delay", {
    default: 30,
    desc: "$TGCS_T0 timestamp after clients start (seconds)",
    ...YargsFloatNonNegative,
  })
  .option("wait-timeout", {
    default: 3600,
    desc: "timeout waiting for clients to finish (seconds), zero means infinite",
    ...YargsFloatNonNegative,
  })
  .option("move-to-primary", {
    default: false,
    desc: "move stats folder to primary host",
    type: "boolean",
  })
  .option(compose.placeOptions)
  .option(Object.fromEntries(Array.from(
    Object.keys(trafficGenerators),
    (tgid) => [tgid, makeOption(tgid)],
  )) as Record<keyof typeof trafficGenerators, ReturnType<typeof makeOption>>)
  .parseSync();

const [c, netdef] = await loadCtx(args);
const { prefix, "ports-per-flow": nPortsPerFlow } = args;
assert(/^[a-z][\da-z]*$/.test(prefix), "--prefix shall be a lower-case letter followed by letters and digits");

const tgFlows = await pipeline(
  () => gatherPduSessions(c, netdef),
  flatMap(function*(ctx) {
    const { sub: { supi }, dn: { dnn } } = ctx;
    for (const [tgid, tg] of Object.entries(trafficGenerators) as Iterable<[keyof typeof trafficGenerators, TrafficGen]>) {
      for (const [index, { dnPattern, uePattern, cFlags, sFlags }] of (args[tgid] ?? []).entries()) {
        if (dnPattern.match(dnn) && uePattern.match(supi)) {
          yield { ...ctx, tgid, tg, group: `${tgid}_${index}`, cFlags, sFlags };
        }
      }
    }
  }),
  collect,
);
assert(tgFlows.length > 0, "No traffic generator defined, are the PDU sessions created?");
tgFlows.sort(sortBy("group", "dn.dnn", "sub.supi"));

const output = compose.create();
let nextPort = args.port;
const table: Array<Array<string | number>> = [];
for (let {
  sub: { supi },
  ueService,
  dn: { snssai, dnn },
  dnService,
  dnIP,
  pduIP,
  pduNetif,
  tgid,
  tg,
  group,
  cFlags,
  sFlags,
} of tgFlows) {
  const port = nextPort;
  let isReversed: extractHashFlag.Match | boolean;
  [cFlags, isReversed] = extractHashFlag(cFlags, /^#r$/i);
  isReversed = !!isReversed;
  assert(!isReversed || !tg.serverPerDN, `${tgid} does not support #R flag`);
  let cCpus: extractHashFlag.Match;
  [cFlags, cCpus] = extractHashFlag(cFlags, /^#cpus=(\d+)$/);
  let sCpus: extractHashFlag.Match;
  [sFlags, sCpus] = extractHashFlag(sFlags, /^#cpus=(\d+)$/);

  const tgFlow: TrafficGenFlowContext = {
    c,
    output,
    prefix,
    group,
    port,
    nPorts: 1,
    ...(isReversed ? {
      cService: dnService,
      cNetif: "n6",
      cIP: dnIP,
      sService: ueService,
      sNetif: pduNetif,
      sIP: pduIP,
    } : {
      cService: ueService,
      cNetif: pduNetif,
      cIP: pduIP,
      sService: dnService,
      sNetif: "n6",
      sIP: dnIP,
    }),
    cFlags,
    sFlags,
  };
  const dn = `${snssai}_${dnn}`;
  let dir = tg.determineDirection(tgFlow);
  if (isReversed) {
    dir = Direction.reverse(dir);
  }

  const services: ComposeService[] = [];

  const serverName = tg.serverPerDN ? `${prefix}_${tgid}_${dn}_s` : `${prefix}_${group}_${port}_s`;
  if (!output.services[serverName]) {
    const server = compose.defineService(output, serverName, tg.dockerImage);
    compose.annotate(server, "cpus", 1);
    copyPlacementNetns(server, tgFlow.sService);
    tg.serverSetup(server, tgFlow);
    if (sCpus) {
      compose.annotate(server, "cpus", Number.parseInt(sCpus[1]!, 10));
    }
    services.push(server);
  }

  const client = compose.defineService(output, `${prefix}_${group}_${port}_c`, tg.dockerImage);
  compose.annotate(client, "cpus", 1);
  copyPlacementNetns(client, tgFlow.cService);
  tg.clientSetup(client, tgFlow);
  services.push(client);
  if (cCpus) {
    compose.annotate(client, "cpus", Number.parseInt(cCpus[1]!, 10));
  }

  for (const s of services) {
    compose.annotate(s, "tgcs_tgid", tgid);
    compose.annotate(s, "tgcs_group", group);
    compose.annotate(s, "tgcs_dn", dn);
    compose.annotate(s, "tgcs_ue", supi);
    compose.annotate(s, "tgcs_dir", dir);
    compose.annotate(s, "tgcs_port", port);
    s.logging = {
      driver: "local",
      options: {
        mode: "non-blocking",
        "max-buffer-size": "4m",
        "max-size": "200m",
        "max-file": 5,
      },
    };
  }

  table.push([group, dn, dir, supi, port]);
  if (nPortsPerFlow) {
    assert(tgFlow.nPorts <= nPortsPerFlow,
      `flow ${group},${dn},${supi} needs ${tgFlow.nPorts} ports but only ${nPortsPerFlow} is allowed`);
    nextPort += nPortsPerFlow;
  } else {
    nextPort += tgFlow.nPorts;
  }
}

compose.place(output, { ...args, "place-match-host": true });
const composeFilename = `compose.${prefix}.yml`;
await file_io.write(path.join(args.dir, composeFilename), output);

await cmdOutput(path.join(args.dir, `${prefix}.sh`), (function*() { // eslint-disable-line complexity
  yield "cd \"$(dirname \"${BASH_SOURCE[0]}\")\""; // eslint-disable-line no-template-curly-in-string
  yield "COMPOSE_CTX=$PWD";
  yield `STATS_DIR=$PWD/${prefix}/`;
  yield "export TGCS_T0=0"; // suppress "variable is not set" warning in non-client step
  yield "ACT=${1:-}"; // eslint-disable-line no-template-curly-in-string
  yield "[[ -z $ACT ]] || shift";
  yield "";

  yield "delete_by_regex() {";
  yield "  $1 ps --filter=\"name=$2\" -aq | xargs -r $1 rm -f";
  yield "}";
  yield "";

  yield "if [[ $ACT == upload ]]; then";
  yield `  exec ${tsrun("compose/upload.ts")} --dir=$COMPOSE_CTX --file=${composeFilename}`;
  yield "fi";
  yield "";

  yield "if [[ -z $ACT ]]; then";
  for (const { hostDesc, dockerH } of compose.classifyByHost(output)) {
    yield `  msg Deleting old trafficgen servers and clients on ${hostDesc}`;
    yield `  with_retry delete_by_regex ${shlex.quote(dockerH)} ${shlex.quote(`^${prefix}_`)} 2>/dev/null`;
  }
  yield "  rm -rf $STATS_DIR";
  yield "fi";
  yield "mkdir -p $STATS_DIR";
  yield `cp $COMPOSE_CTX/${prefix}.tsv $STATS_DIR/setup.tsv`;
  yield "";

  yield "if [[ -z $ACT ]] || [[ $ACT == servers ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output, (ct) => ct.endsWith("_s"))) {
    yield `  msg Starting trafficgen servers on ${hostDesc}`;
    yield `  with_retry env COMPOSE_IGNORE_ORPHANS=1 ${dockerH} compose -f ${
      composeFilename} up -d ${names.join(" ")}`;
  }
  yield `  sleep ${args["startup-delay"]}`;
  yield "fi";
  yield "";

  yield "if [[ -z $ACT ]] || [[ $ACT == clients ]]; then";
  if (Object.values(output.services).some((s) => s.environment.TGCS_T0)) {
    yield `  TGCS_T0=$(echo $(date -u +%s.%N) ${args["t0-delay"]} | awk '{ printf "%0.9f", $1+$2 }')`;
    yield "  msg \\$TGCS_T0 is set to $TGCS_T0";
  }
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output, (ct) => ct.endsWith("_c"))) {
    yield `  msg Starting trafficgen clients on ${hostDesc}`;
    yield `  with_retry env COMPOSE_IGNORE_ORPHANS=1 ${dockerH} compose -f ${
      composeFilename} up -d ${names.join(" ")}`;
  }
  yield "fi";
  yield "";

  yield "if [[ -z $ACT ]] || [[ $ACT == wait ]]; then";
  const waitTimeout = `${args["wait-timeout"]}s`;
  yield `  msg Waiting for trafficgen clients to finish with ${waitTimeout.replace(/^0s$/, "infinite")} timeout`;
  yield `  timeout --foreground ${waitTimeout} bash -c ${shlex.quote(Array.from(
    Object.values(output.services).filter(({ container_name: ct }) => ct.endsWith("_c")),
    (s) => `echo ${s.container_name} $(${compose.makeDockerH(s)} wait ${s.container_name})`,
  ).join("\n"))} || msg Timeout exceeded, results may be incomplete`;
  yield "fi";
  yield "";

  yield "if [[ -z $ACT ]] || [[ $ACT == collect ]]; then";
  yield "  msg Gathering trafficgen statistics to $STATS_DIR";
  for (const s of Object.values(output.services)) {
    const tg = trafficGenerators[compose.annotate(s, "tgcs_tgid") as keyof typeof trafficGenerators];
    const group = compose.annotate(s, "tgcs_group")!;
    const port = compose.annotate(s, "tgcs_port")!;
    const dn = compose.annotate(s, "tgcs_dn")!;
    const statsExt = compose.annotate(s, "tgcs_stats_ext") ?? ".log";
    const timestampFlag = compose.annotate(s, "tgcs_docker_timestamps") ? " -t" : "";
    const logerrPipe = compose.annotate(s, "tgcs_docker_logerr") ? "&>" : ">";
    const ct = s.container_name;
    const basename = tg.serverPerDN && ct.endsWith("_s") ? `${group}-${dn}` : `${group}-${port}`;
    yield `  ${compose.makeDockerH(s)} logs${timestampFlag} ${
      ct} ${logerrPipe}$\{STATS_DIR}${basename}-${ct.slice(-1)}${statsExt}`;
  }
  yield "fi";
  yield "";

  yield "if [[ -z $ACT ]] || [[ $ACT == stop ]]; then";
  for (const { host, hostDesc, dockerH, names, services } of compose.classifyByHost(output)) {
    yield `  msg Deleting trafficgen servers and clients on ${hostDesc}`;
    yield `  with_retry env COMPOSE_IGNORE_ORPHANS=1 ${dockerH} compose -f ${
      composeFilename} stop -t 2 ${names.join(" ")} >/dev/null`;
    yield `  with_retry delete_by_regex ${shlex.quote(dockerH)} ${shlex.quote(`^${prefix}_`)} >/dev/null`;
    if (host && args["move-to-primary"] && services.some((s) => s.volumes.some((volume) => volume.target === "/output"))) {
      yield `  msg Moving $STATS_DIR from ${hostDesc} to primary`;
      yield `  docker run --rm --network host -v ~/.ssh/id_ed25519:/sshkey:ro -v $STATS_DIR:/target${
        " "}rclone/rclone move :sftp:$STATS_DIR /target ${shlex.join([
        "--transfers=2",
        "--inplace",
        ...compose.makeRcloneSftpFlags(host),
        ...(host.startsWith("root@") ? [] : ["--sftp-server-command=sudo /usr/lib/openssh/sftp-server"]),
        "--log-level=ERROR",
      ])}`;
    }
  }
  if (args["move-to-primary"] && Object.values(output.services).some((s) => s.volumes.some((volume) => volume.target === "/output"))) {
    yield "  msg Running chmod on $STATS_DIR";
    yield "  sudo chown -R $(id -un):$(id -gn) $STATS_DIR";
  }
  yield "fi";
  yield "";

  yield "if [[ -z $ACT ]] || [[ $ACT == stats ]]; then";
  yield "  cd $STATS_DIR";
  for (const [tgid, tg] of Object.entries(trafficGenerators) as Iterable<[keyof typeof trafficGenerators, TrafficGen]>) {
    if (!args[tgid]) {
      continue;
    } else if (tg.statsCommands) {
      yield* oblMap(tg.statsCommands(prefix), (line) => `  ${line}`);
    } else {
      yield `  msg ${tg.name ?? tgid} statistics analysis is not supported`;
    }
  }
  yield "  cd $COMPOSE_CTX";
  yield "fi";
})());

const counts = new DefaultMap<string, [cnt: number, group: string]>((group: string) => [0, group]);
for (const row of table) {
  const group = row[0]! as string;
  counts.get(group)[0] += 1;
}
table.push(...oblMap(counts.values(),
  ([cnt, group]) => [group, "*", "*", "COUNT", cnt],
));
const tTable = file_io.toTable(
  ["group", "snssai_dnn", "dir", "supi", "port"],
  table,
);
await file_io.write(path.join(args.dir, `${prefix}.tsv`), tTable.tsv);
await file_io.write("-", tTable.tui);
