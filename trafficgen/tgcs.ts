import path from "node:path";

import { Minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import oblMap from "obliterator/map.js";
import * as shlex from "shlex";
import { sortBy } from "sort-by-typescript";
import { collect, flatTransform, map, pipeline } from "streaming-iterables";

import * as compose from "../compose/mod.js";
import type { ComposeService } from "../types/mod.js";
import { assert, cmdOutput, codebaseRoot, file_io, splitVbar, Yargs } from "../util/mod.js";
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
    desc: `define ${tgid} flows`,
    nargs: 1,
    type: "string",
  } as const;
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
  .option("startup-delay", {
    default: 5000,
    desc: "wait duration (milliseconds) between starting servers and starting clients",
    type: "number",
  })
  .option(compose.placeOptions)
  .option(Object.fromEntries(Array.from(
    Object.keys(trafficGenerators),
    (tgid) => [tgid, makeOption(tgid)],
  )) as Record<keyof typeof trafficGenerators, ReturnType<typeof makeOption>>)
  .parseSync();

const [c, netdef] = await loadCtx(args);
let { prefix } = args;
assert(/^[a-z][\da-z]*$/i.test(prefix), "--prefix shall be a letter followed by letters and digits");
prefix = prefix.toLowerCase();

const output = compose.create();
let nextPort = args.port;
const table = await pipeline(
  () => gatherPduSessions(c, netdef),
  flatTransform(16, function*(ctx) {
    const { sub: { supi }, dn: { dnn } } = ctx;
    for (const [tgid, tg] of Object.entries(trafficGenerators) as Iterable<[keyof typeof trafficGenerators, TrafficGen]>) {
      for (const [index, { dnPattern, uePattern, cFlags, sFlags }] of (args[tgid] ?? []).entries()) {
        if (dnPattern.match(dnn) && uePattern.match(supi)) {
          yield { ...ctx, tgid, tg, group: `${tgid}_${index}`, cFlags, sFlags };
        }
      }
    }
  }),
  map(({
    sub: { supi },
    ueService,
    dn: { snssai, dnn },
    dnService,
    dnIP,
    pduIP,
    tgid,
    tg,
    group,
    cFlags,
    sFlags,
  }) => {
    const port = nextPort;
    nextPort += tg.nPorts;

    let isReversed: RegExpMatchArray | undefined | boolean;
    [cFlags, isReversed] = extractHashFlag(cFlags, /^#r$/i);
    isReversed = !!isReversed;
    assert(!isReversed || !tg.serverPerDN, `${tgid} does not support #R flag`);

    const tgFlow: TrafficGenFlowContext = {
      c,
      output,
      prefix,
      group,
      port,
      dnIP,
      pduIP,
      cIP: isReversed ? dnIP : pduIP,
      cFlags,
      sIP: isReversed ? pduIP : dnIP,
      sFlags,
      dnService,
      ueService,
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
      copyPlacementNetns(server, isReversed ? ueService : dnService);
      tg.serverSetup(server, tgFlow);
      services.push(server);
    }

    const client = compose.defineService(output, `${prefix}_${group}_${port}_c`, tg.dockerImage);
    compose.annotate(client, "cpus", 1);
    copyPlacementNetns(client, isReversed ? dnService : ueService);
    tg.clientSetup(client, tgFlow);
    services.push(client);

    for (const s of services) {
      compose.annotate(s, "tgcs_tgid", tgid);
      compose.annotate(s, "tgcs_group", group);
      compose.annotate(s, "tgcs_dn", dn);
      compose.annotate(s, "tgcs_ue", supi);
      compose.annotate(s, "tgcs_dir", dir);
      compose.annotate(s, "tgcs_port", port);
    }

    return [group, dn, dir, supi, port];
  }),
  collect,
);

compose.place(output, { ...args, "place-match-host": true });
const composeFilename = `compose.${prefix}.yml`;
await file_io.write(path.join(args.dir, composeFilename), output);

await cmdOutput(path.join(args.dir, `${prefix}.sh`), (function*() {
  yield "cd \"$(dirname \"${BASH_SOURCE[0]}\")\""; // eslint-disable-line no-template-curly-in-string
  yield "COMPOSE_CTX=$PWD";
  yield `STATS_DIR=$PWD/${prefix}/`;
  yield "ACT=${1:-}"; // eslint-disable-line no-template-curly-in-string
  yield "[[ -z $ACT ]] || shift";
  yield "";

  yield "delete_by_regex() {";
  yield "  $1 ps --filter=\"name=$2\" -aq | xargs -r $1 rm -f";
  yield "}";
  yield "";

  yield "if [[ $ACT == upload ]]; then";
  yield `  exec $(env -C ${codebaseRoot} corepack pnpm bin)/tsx ${codebaseRoot}/compose/upload.ts --dir=$COMPOSE_CTX --file=${composeFilename}`;
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
  yield `  sleep ${(args["startup-delay"] / 1000).toFixed(3)}`;
  yield "fi";
  yield "";

  yield "if [[ -z $ACT ]] || [[ $ACT == clients ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output, (ct) => ct.endsWith("_c"))) {
    yield `  msg Starting trafficgen clients on ${hostDesc}`;
    yield `  with_retry env COMPOSE_IGNORE_ORPHANS=1 ${dockerH} compose -f ${
      composeFilename} up -d ${names.join(" ")}`;
  }
  yield "fi";
  yield "";

  yield "if [[ -z $ACT ]] || [[ $ACT == wait ]]; then";
  yield "  msg Waiting for trafficgen clients to finish";
  for (const s of Object.values(output.services).filter(({ container_name: ct }) => ct.endsWith("_c"))) {
    yield `  echo ${s.container_name} $(${compose.makeDockerH(s)} wait ${s.container_name})`;
  }
  yield "fi";
  yield "";

  yield "if [[ -z $ACT ]] || [[ $ACT == collect ]]; then";
  yield "  msg Gathering trafficgen statistics to $STATS_DIR";
  for (const s of Object.values(output.services)) {
    const tg = trafficGenerators[compose.annotate(s, "tgcs_tgid") as keyof typeof trafficGenerators];
    const group = compose.annotate(s, "tgcs_group")!;
    const port = compose.annotate(s, "tgcs_port")!;
    const dn = compose.annotate(s, "tgcs_dn")!;
    const timestampFlag = compose.annotate(s, "tgcs_docker_timestamps") ? " -t" : "";
    const ct = s.container_name;
    const basename = tg.serverPerDN && ct.endsWith("s") ? `${group}-${dn}` : `${group}-${port}`;
    yield `  ${compose.makeDockerH(s)} logs${timestampFlag} ${
      ct} >$\{STATS_DIR}${basename}-${ct.slice(-1)}${tg.statsExt}`;
  }
  yield "fi";
  yield "";

  yield "if [[ -z $ACT ]] || [[ $ACT == stop ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output)) {
    yield `  msg Deleting trafficgen servers and clients on ${hostDesc}`;
    yield `  with_retry env COMPOSE_IGNORE_ORPHANS=1 ${dockerH} compose -f ${
      composeFilename} stop -t 2 ${names.join(" ")} >/dev/null`;
    yield `  with_retry delete_by_regex ${shlex.quote(dockerH)} ${shlex.quote(`^${prefix}_`)} >/dev/null`;
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
      yield `  msg ${tgid} statistics analysis is not supported`;
    }
  }
  yield "  cd $COMPOSE_CTX";
  yield "fi";
})());

assert(table.length > 0, "No traffic generator defined, are the PDU sessions created?");
table.sort(sortBy("0", "1", "2", "3"));
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
await file_io.write(path.join(args.dir, `${args.prefix}.tsv`), tTable.tsv);
await file_io.write("-", tTable.tui);
