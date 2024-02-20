import path from "node:path";

import type { LinkWithAddressInfo } from "iproute";
import assert from "minimalistic-assert";
import { Minimatch } from "minimatch";
import { Netmask } from "netmask";
import * as shlex from "shlex";
import { consume, flatTransform, pipeline, tap, transform } from "streaming-iterables";

import * as compose from "../compose/mod.js";
import { NetDef } from "../netdef/netdef.ts";
import type { ComposeFile, N } from "../types/mod.ts";
import { dockerode, file_io, Yargs } from "../util/mod.js";

const args = Yargs()
  .option("dir", {
    demandOption: true,
    desc: "Compose context directory",
    type: "string",
  })
  .option("netdef", {
    defaultDescription: "(--dir)/netdef.json",
    desc: "NetDef filename",
    type: "string",
  })
  .option("flow", {
    coerce(lines: readonly string[]): Array<[pattern: Minimatch, flags: readonly string[]]> {
      assert(Array.isArray(lines));
      return Array.from(lines, (line) => {
        const tokens = line.split("=");
        assert(tokens.length === 2, `bad --flow ${line}`);
        return [
          new Minimatch(tokens[0].trim()),
          shlex.split(tokens[1].trim()),
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
args.netdef ??= path.join(args.dir, "netdef.json");

const c = await file_io.readYAML(path.join(args.dir, "compose.yml")) as ComposeFile;
const netdef = new NetDef(await file_io.readJSON(args.netdef) as N.Network);
netdef.validate();

const output = compose.create();
let nextPort = 20000;
await pipeline(
  () => netdef.listSubscribers(),
  transform(16, async (sub) => {
    const ueService = compose.findByAnnotation(c, "ue_supi", (value) => value.split(",").includes(sub.supi));
    assert(ueService, `UE container for ${sub.supi} not found`);
    const ueHost = compose.annotate(ueService, "host") ?? "";
    const ct = dockerode.getContainer(ueService.container_name, ueHost);
    const ipAddrs = await dockerode.execCommand(ct, ["ip", "-j", "addr", "show"]);
    const ueIPs = JSON.parse(ipAddrs.stdout) as LinkWithAddressInfo[];
    return { sub, ueService, ueHost, ueIPs };
  }),
  flatTransform(16, function*(ctx) {
    const { sub, ueIPs } = ctx;
    for (const dnID of sub.subscribedDN) {
      const dn = netdef.findDN(dnID);
      if (!dn?.subnet) {
        continue;
      }
      const dnSubnet = new Netmask(dn.subnet);

      const dnService = compose.findByAnnotation(c, "dn", `${dn.snssai}_${dn.dnn}`);
      assert(dnService, `DN container for ${dn.dnn} not found`);
      const dnHost = compose.annotate(dnService, "host") ?? "";
      const dnIP = dnService.networks.n6!.ipv4_address;

      const pduIP = ueIPs.flatMap((link) => {
        const addr = link.addr_info.find((addr) => addr.family === "inet" && dnSubnet.contains(addr.local));
        return addr ?? [];
      })[0];
      if (!pduIP) {
        continue;
      }
      yield { ...ctx, dn, dnService, dnHost, dnIP, pduIP: pduIP.local };
    }
  }),
  flatTransform(16, function*(ctx) {
    const { dn: { dnn } } = ctx;
    const flagsTuple = args.flow.filter(([pattern]) => pattern.match(dnn));
    for (const [, flags] of flagsTuple) {
      yield { ...ctx, flags };
    }
  }),
  tap((ctx) => {
    const { sub: { supi }, ueService, ueHost, dn: { snssai, dnn }, dnHost, dnService, dnIP, pduIP, flags } = ctx;
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

    const dir = flags.includes("-R") ? ">" : "<";
    for (const s of [server, client]) {
      compose.annotate(s, "iperf3_dn", `${snssai}_${dnn}`);
      compose.annotate(s, "iperf3_ue", supi);
      compose.annotate(s, "iperf3_dir", dir);
      compose.annotate(s, "iperf3_port", port);
    }
  }),
  consume,
);

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

process.stdout.write(`${Object.keys(output.services).length / 2}\n`);
