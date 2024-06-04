import path from "node:path";

import { Minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import oblMap from "obliterator/map.js";
import * as shlex from "shlex";
import { sortBy } from "sort-by-typescript";
import { collect, flatTransform, map, pipeline } from "streaming-iterables";
import assert from "tiny-invariant";

import * as compose from "../compose/mod.js";
import { file_io, scriptHead, Yargs } from "../util/mod.js";
import { ctxOptions, gatherPduSessions, loadCtx } from "./common.js";
import { trafficGenerators, type TrafficGenFlowContext } from "./pduperf-tg.js";

const args = Yargs()
  .option(ctxOptions)
  .option("mode", {
    choices: Object.keys(trafficGenerators),
    demandOption: true,
    desc: "traffic generator",
    type: "string",
  })
  .option("prefix", {
    defaultDescription: "same as mode",
    desc: "container name prefix",
    type: "string",
  })
  .option("port", {
    default: 20000,
    desc: "starting port number",
    type: "number",
  })
  .option("flow", {
    array: true,
    coerce(lines: readonly string[]): Array<{
      dnPattern: Minimatch;
      uePattern: Minimatch;
    } & Pick<TrafficGenFlowContext, "cFlags" | "sFlags">> {
      return Array.from(lines, (line) => {
        const tokens = line.split("|");
        assert([2, 3, 4].includes(tokens.length), `bad --flow ${line}`);
        return {
          dnPattern: new Minimatch(tokens[0]!.trim()),
          uePattern: new Minimatch(tokens[1]!.trim()),
          cFlags: shlex.split(tokens[2]?.trim() ?? ""),
          sFlags: shlex.split(tokens[3]?.trim() ?? ""),
        };
      });
    },
    demandOption: true,
    desc: "PDU session selector and traffic generator flags",
    nargs: 1,
    type: "string",
  })
  .parseSync();

const tg = trafficGenerators[args.mode]!;
args.prefix ??= args.mode;
const [c, netdef] = await loadCtx(args);

const output = compose.create();
let nextPort = args.port;
const table = await pipeline(
  () => gatherPduSessions(c, netdef),
  flatTransform(16, function*(ctx) {
    const { sub: { supi }, dn: { dnn } } = ctx;
    for (const [index, { dnPattern, uePattern, cFlags, sFlags }] of args.flow.entries()) {
      if (dnPattern.match(dnn) && uePattern.match(supi)) {
        yield { ...ctx, index, cFlags, sFlags };
      }
    }
  }),
  map((ctx) => {
    const { sub: { supi }, ueService, ueHost, dn: { snssai, dnn }, dnHost, dnService, dnIP, pduIP, index, cFlags, sFlags } = ctx;
    const port = nextPort;
    nextPort += tg.nPorts;
    const tgFlow: TrafficGenFlowContext = { prefix: args.prefix!, port, dnIP, pduIP, cFlags, sFlags, dnService, ueService };

    const server = compose.defineService(output, `${args.prefix}_${port}_s`, tg.serverDockerImage);
    compose.annotate(server, "host", dnHost);
    server.cpuset = dnService.cpuset;
    server.network_mode = `service:${dnService.container_name}`;
    tg.serverSetup(server, tgFlow);

    const client = compose.defineService(output, `${args.prefix}_${port}_c`, tg.clientDockerImage);
    compose.annotate(client, "host", ueHost);
    client.cpuset = ueService.cpuset;
    client.network_mode = `service:${ueService.container_name}`;
    tg.clientSetup(client, tgFlow);

    const dn = `${snssai}_${dnn}`;
    const dir = tg.determineDirection(tgFlow);
    for (const s of [server, client]) {
      compose.annotate(s, "pduperf_mode", args.mode);
      compose.annotate(s, "pduperf_dn", dn);
      compose.annotate(s, "pduperf_ue", supi);
      compose.annotate(s, "pduperf_dir", dir);
      compose.annotate(s, "pduperf_port", port);
    }

    return [
      index,
      dn,
      dir,
      supi,
      port,
    ];
  }),
  collect,
);

const composeFilename = `compose.${args.prefix}.yml`;
await file_io.write(path.join(args.dir, composeFilename), output);

function* makeScript(): Iterable<string> {
  yield "cd \"$(dirname \"${BASH_SOURCE[0]}\")\""; // eslint-disable-line no-template-curly-in-string
  yield "COMPOSE_CTX=$PWD";
  yield `STATS_DIR=$PWD/${args.prefix}/`;
  yield "ACT=${1:-}"; // eslint-disable-line no-template-curly-in-string
  yield "[[ -z $ACT ]] || shift";

  yield "if [[ -z $ACT ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output)) {
    yield `  msg Deleting old trafficgen servers and clients on ${hostDesc}`;
    yield `  with_retry ${dockerH} rm -f ${names.join(" ")}`;
  }
  yield "  rm -rf $STATS_DIR";
  yield "fi";
  yield "mkdir -p $STATS_DIR";

  yield "if [[ -z $ACT ]] || [[ $ACT == servers ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output, /_s$/)) {
    yield `  msg Starting trafficgen servers on ${hostDesc}`;
    yield `  with_retry ${dockerH} compose -f compose.yml -f ${composeFilename} up -d ${names.join(" ")}`;
  }
  yield "  sleep 5";
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == clients ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output, /_c$/)) {
    yield `  msg Starting trafficgen clients on ${hostDesc}`;
    yield `  with_retry ${dockerH} compose -f compose.yml -f ${composeFilename} up -d ${names.join(" ")}`;
  }
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == wait ]]; then";
  yield "  msg Waiting for trafficgen clients to finish";
  for (const s of Object.values(output.services).filter((s) => s.container_name.endsWith("_c"))) {
    yield `  ${compose.makeDockerH(s)} wait ${s.container_name}`;
  }
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == collect ]]; then";
  yield `  msg Gathering trafficgen statistics to $\{STATS_DIR}'*${tg.statsExt}'`;
  for (const s of Object.values(output.services)) {
    const ct = s.container_name;
    yield `  ${compose.makeDockerH(s)} logs ${ct} >$\{STATS_DIR}${ct.slice(args.prefix!.length + 1)}${tg.statsExt}`;
  }
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == stop ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output)) {
    yield `  msg Deleting trafficgen servers and clients on ${hostDesc}`;
    yield `  with_retry ${dockerH} rm -f ${names.join(" ")}`;
  }
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == stats ]]; then";
  yield* tg.statsCommands(args.prefix!);
  yield "fi";
}

await file_io.write(path.join(args.dir, `${args.prefix}.sh`), [
  "#!/bin/bash",
  ...scriptHead,
  ...makeScript(),
].join("\n"));

table.sort(sortBy("0", "1", "2", "3"));
const counts = new DefaultMap<number, [cnt: number, index: number]>((index: number) => [0, index]);
for (const row of table) {
  const index = row[0]! as number;
  counts.get(index)[0] += 1;
}
table.push(...oblMap(counts.values(),
  ([cnt, index]) => [index, "*", "*", "COUNT", cnt],
));
await file_io.write("-", file_io.toTable(
  ["#", "snssai_dnn", "dir", "supi", "port"],
  table,
).tui);
