import path from "node:path";

import { stringify as csv } from "csv-stringify/sync";
import assert from "minimalistic-assert";
import { Minimatch } from "minimatch";
import * as shlex from "shlex";
import { sortBy } from "sort-by-typescript";
import { collect, flatTransform, map, pipeline } from "streaming-iterables";

import * as compose from "../compose/mod.js";
import { file_io, Yargs } from "../util/mod.js";
import { ctxOptions, gatherPduSessions, loadCtx } from "./common.js";

const args = Yargs()
  .option(ctxOptions)
  .option("flow", {
    coerce(lines: readonly string[]): Array<[dn: Minimatch, ue: Minimatch, flags: readonly string[]]> {
      assert(Array.isArray(lines));
      return Array.from(lines, (line) => {
        const tokens = line.split("|");
        assert(tokens.length === 3, `bad --flow ${line}`);
        return [
          new Minimatch(tokens[0].trim()),
          new Minimatch(tokens[1].trim()),
          shlex.split(tokens[2].trim()),
        ];
      });
    },
    demandOption: true,
    desc: "iperf3 flags for PDU sessions",
    nargs: 1,
    string: true,
    type: "array",
  })
  .parseSync();

const [c, netdef] = await loadCtx(args);

const output = compose.create();
let nextPort = 20000;
const table = await pipeline(
  () => gatherPduSessions(c, netdef),
  flatTransform(16, function*(ctx) {
    const { sub: { supi }, dn: { dnn } } = ctx;
    for (const [index, [dnPattern, uePattern, flags]] of args.flow.entries()) {
      if (dnPattern.match(dnn) && uePattern.match(supi)) {
        yield { ...ctx, index, flags };
      }
    }
  }),
  map((ctx) => {
    const { sub: { supi }, ueService, ueHost, dn: { snssai, dnn }, dnHost, dnService, dnIP, pduIP, index, flags } = ctx;
    const port = nextPort++;
    const server = compose.defineService(output, `iperf3_${port}_s`, "networkstatic/iperf3");
    compose.annotate(server, "host", dnHost);
    server.cpuset = dnService.cpuset;
    server.network_mode = `service:${dnService.container_name}`;
    server.command = [
      "--forceflush",
      "--json",
      "-B", dnIP,
      "-p", `${port}`,
      "-s",
    ];

    const client = compose.defineService(output, `iperf3_${port}_c`, "networkstatic/iperf3");
    compose.annotate(client, "host", ueHost);
    client.cpuset = ueService.cpuset;
    client.network_mode = `service:${ueService.container_name}`;
    client.command = [
      "--forceflush",
      "--json",
      "-B", pduIP,
      "-p", `${port}`,
      "--cport", `${port}`,
      "-c", dnIP,
      ...flags,
    ];

    const dn = `${snssai}_${dnn}`;
    const dir = flags.includes("-R") ? "DL>" : "<UL";
    for (const s of [server, client]) {
      compose.annotate(s, "iperf3_dn", dn);
      compose.annotate(s, "iperf3_ue", supi);
      compose.annotate(s, "iperf3_dir", dir);
      compose.annotate(s, "iperf3_port", port);
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
table.sort(sortBy("0", "1", "2", "3"));

await file_io.write(path.join(args.dir, "compose.iperf3.yml"), output);

function* makeScript(): Iterable<string> {
  yield "cd \"$(dirname \"${BASH_SOURCE[0]}\")\""; // eslint-disable-line no-template-curly-in-string
  yield "COMPOSE_CTX=$PWD";
  yield "ACT=${1:-}"; // eslint-disable-line no-template-curly-in-string
  yield "[[ -z $ACT ]] || shift";

  yield "if [[ -z $ACT ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output)) {
    yield `  msg Deleting old iperf3 servers and clients on ${hostDesc}`;
    yield `  with_retry ${dockerH} rm -f ${names.join(" ")}`;
  }
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == servers ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output, /_s$/)) {
    yield `  msg Starting iperf3 servers on ${hostDesc}`;
    yield `  with_retry ${dockerH} compose -f compose.yml -f compose.iperf3.yml up -d ${names.join(" ")}`;
  }
  yield "  sleep 5";
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == clients ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output, /_c$/)) {
    yield `  msg Starting iperf3 clients on ${hostDesc}`;
    yield `  with_retry ${dockerH} compose -f compose.yml -f compose.iperf3.yml up -d ${names.join(" ")}`;
  }
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == wait ]]; then";
  yield "  msg Waiting for iperf3 clients to finish";
  for (const s of Object.values(output.services).filter((s) => s.container_name.endsWith("_c"))) {
    yield `  ${compose.makeDockerH(s)} wait ${s.container_name}`;
  }
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == collect ]]; then";
  yield "  msg Gathering iperf3 statistics to 'iperf3/*.json'";
  yield "  mkdir -p iperf3/";
  for (const s of Object.values(output.services).filter((s) => s.container_name.endsWith("_c"))) {
    const ct = s.container_name;
    yield `  ${compose.makeDockerH(s)} logs ${ct} | jq -s .[-1] >iperf3/${ct.slice(7)}.json`;
  }
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == stop ]]; then";
  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output)) {
    yield `  msg Deleting iperf3 servers and clients on ${hostDesc}`;
    yield `  with_retry ${dockerH} rm -f ${names.join(" ")}`;
  }
  yield "fi";

  yield "if [[ -z $ACT ]] || [[ $ACT == stats ]]; then";
  yield "  msg Gathering iperf3 statistics table to iperf3.tsv";
  yield `  cd ${path.join(import.meta.dirname, "..")}`;
  yield "  $(corepack pnpm bin)/tsx trafficgen/iperf3-stats.ts --dir=$COMPOSE_CTX";
  yield "  cd $COMPOSE_CTX";
  yield "  column -t <iperf3.tsv";
  yield "fi";
}

await file_io.write(path.join(args.dir, "iperf3.sh"), [
  "#!/bin/bash",
  ...compose.scriptHead,
  ...makeScript(),
].join("\n"));

process.stdout.write(csv(table, {
  delimiter: "\t",
  header: true,
  columns: ["#", "snssai_dnn", "dir", "supi", "port"],
}));
