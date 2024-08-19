import path from "node:path";

import { Minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import oblMap from "obliterator/map.js";
import * as shlex from "shlex";
import { sortBy } from "sort-by-typescript";
import { collect, flatTransform, map, pipeline } from "streaming-iterables";

import * as compose from "../compose/mod.js";
import type { ComposeService } from "../types/mod.js";
import { assert, cmdOutput, file_io, splitVbar, Yargs } from "../util/mod.js";
import { copyPlacementNetns, ctxOptions, gatherPduSessions, loadCtx } from "./common.js";
import type { TrafficGen, TrafficGenFlowContext } from "./tgcs-defs.js";
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
  .option(Object.fromEntries(Array.from(
    Object.keys(trafficGenerators),
    (tgid) => [tgid, makeOption(tgid)],
  )) as Record<keyof typeof trafficGenerators, ReturnType<typeof makeOption>>)
  .parseSync();

const [c, netdef] = await loadCtx(args);
const { prefix } = args;

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
    const tgFlow: TrafficGenFlowContext = {
      c,
      output,
      prefix,
      group,
      port,
      dnIP,
      pduIP,
      cFlags,
      sFlags,
      dnService,
      ueService,
    };
    const dn = `${snssai}_${dnn}`;
    const dir = tg.determineDirection(tgFlow);

    const services: ComposeService[] = [];

    const serverName = tg.serverPerDN ? `${prefix}_${tgid}_${dn}_s` : `${prefix}_${group}_${port}_s`;
    if (!output.services[serverName]) {
      const server = compose.defineService(output, serverName, tg.serverDockerImage);
      copyPlacementNetns(server, dnService);
      tg.serverSetup(server, tgFlow);
      services.push(server);
    }

    const client = compose.defineService(output, `${prefix}_${group}_${port}_c`, tg.clientDockerImage);
    copyPlacementNetns(client, ueService);
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

const composeFilename = `compose.${prefix}.yml`;
await file_io.write(path.join(args.dir, composeFilename), output);

await cmdOutput(path.join(args.dir, `${prefix}.sh`), (function*() {
  yield "cd \"$(dirname \"${BASH_SOURCE[0]}\")\""; // eslint-disable-line no-template-curly-in-string
  yield "COMPOSE_CTX=$PWD";
  yield `STATS_DIR=$PWD/${prefix}/`;
  yield "ACT=${1:-}"; // eslint-disable-line no-template-curly-in-string
  yield "[[ -z $ACT ]] || shift";

  yield "if [[ -z $ACT ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output)) {
    yield `  msg Deleting old trafficgen servers and clients on ${hostDesc}`;
    yield `  with_retry ${dockerH} rm -f ${names.join(" ")} 2>/dev/null`;
  }
  yield "  rm -rf $STATS_DIR";
  yield "fi";
  yield "mkdir -p $STATS_DIR";

  yield "if [[ -z $ACT ]] || [[ $ACT == servers ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output, (ct) => ct.endsWith("_s"))) {
    yield `  msg Starting trafficgen servers on ${hostDesc}`;
    yield `  with_retry env COMPOSE_IGNORE_ORPHANS=1 ${dockerH} compose -f ${
      composeFilename} up -d ${names.join(" ")}`;
  }
  yield `  sleep ${(args["startup-delay"] / 1000).toFixed(3)}`;
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == clients ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output, (ct) => ct.endsWith("_c"))) {
    yield `  msg Starting trafficgen clients on ${hostDesc}`;
    yield `  with_retry env COMPOSE_IGNORE_ORPHANS=1 ${dockerH} compose -f ${
      composeFilename} up -d ${names.join(" ")}`;
  }
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == wait ]]; then";
  yield "  msg Waiting for trafficgen clients to finish";
  for (const s of Object.values(output.services).filter((s) => s.container_name.endsWith("_c"))) {
    yield `  echo ${s.container_name} $(${compose.makeDockerH(s)} wait ${s.container_name})`;
  }
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == collect ]]; then";
  yield "  msg Gathering trafficgen statistics to $STATS_DIR";
  for (const s of Object.values(output.services)) {
    const tg = trafficGenerators[compose.annotate(s, "tgcs_tgid") as keyof typeof trafficGenerators];
    const group = compose.annotate(s, "tgcs_group")!;
    const port = compose.annotate(s, "tgcs_port")!;
    const dn = compose.annotate(s, "tgcs_dn")!;
    const ct = s.container_name;
    const basename = tg.serverPerDN && ct.endsWith("s") ? `${group}-${dn}` : `${group}-${port}`;
    yield `  ${compose.makeDockerH(s)} logs ${ct} >$\{STATS_DIR}${basename}-${ct.slice(-1)}${tg.statsExt}`;
  }
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == stop ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output)) {
    yield `  msg Deleting trafficgen servers and clients on ${hostDesc}`;
    yield `  with_retry env COMPOSE_IGNORE_ORPHANS=1 ${dockerH} compose -f ${
      composeFilename} stop -t 2 ${names.join(" ")} >/dev/null`;
    yield `  with_retry ${dockerH} rm -f ${names.join(" ")} >/dev/null`;
  }
  yield "fi";

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
