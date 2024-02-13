import path from "node:path";

import type { LinkWithAddressInfo } from "iproute";
import assert from "minimalistic-assert";
import { Minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import { Netmask } from "netmask";
import * as shlex from "shlex";
import { consume, flatTransform, pipeline, tap, transform } from "streaming-iterables";

import * as compose from "../../compose/mod.js";
import { NetDef } from "../../netdef/netdef.ts";
import type { ComposeFile, ComposeService, N } from "../../types/mod.ts";
import { dockerode, file_io, Yargs } from "../../util/mod.js";

const args = Yargs()
  .option("dir", {
    demandOption: true,
    desc: "Compose context directory",
    type: "string",
  })
  .option("netdef", {
    defaultDescription: "netdef.json in Compose context",
    desc: "NetDef filename",
    type: "string",
  })
  .option("flow", {
    demandOption: true,
    desc: "iperf3 flags for PDU sessions",
    nargs: 1,
    string: true,
    type: "array",
  })
  .parseSync();
args.netdef ??= path.join(args.dir, "netdef.json");

const iperf3flows = Array.from<string, [pattern: Minimatch, flags: readonly string[]]>(
  args.flow,
  (line) => {
    const index = line.indexOf("=");
    assert(index >= 1, `invalid --flags ${line}`);
    return [
      new Minimatch(line.slice(0, index)),
      shlex.split(line.slice(index + 1)),
    ];
  },
);

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
    const flagsTuple = iperf3flows.filter(([pattern]) => pattern.match(dnn));
    for (const [, flags] of flagsTuple) {
      yield { ...ctx, flags };
    }
  }),
  tap((ctx) => {
    const { sub: { supi }, ueService, ueHost, dn: { snssai, dnn }, dnHost, dnService, dnIP, pduIP, flags } = ctx;
    const port = ++nextPort;
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

    for (const s of [server, client]) {
      compose.annotate(s, "iperf3_dn", `${snssai}_${dnn}`);
      compose.annotate(s, "iperf3_ue", supi);
      compose.annotate(s, "iperf3_port", port);
    }
  }),
  consume,
);

await file_io.write(path.join(args.dir, "compose.iperf3.yml"), output);

function* listContainersByHost(suffix: string): Iterable<[host: string, docker: string, cts: readonly string[]]> {
  const services = Object.values(output.services).filter((s) => s.container_name.endsWith(suffix));
  const byHost = new DefaultMap<string, ComposeService[]>(() => []);
  for (const s of services) {
    byHost.get(compose.annotate(s, "host")!).push(s);
  }
  for (const [host, services] of byHost) {
    yield [
      host || "PRIMARY",
      compose.makeDockerH(host),
      services.map((s) => s.container_name),
    ];
  }
}

function withRetry(cmd: string): string {
  return `while ! ${cmd}; do sleep 0.1; done`;
}

function* makeScript(): Iterable<string> {
  for (const [host, docker, cts] of listContainersByHost("")) {
    yield `msg Deleting old iperf3 servers and clients on ${host}`;
    yield withRetry(`${docker} rm -f ${cts.join(" ")}`);
  }

  for (const [host, docker, cts] of listContainersByHost("_s")) {
    yield `msg Starting iperf3 servers on ${host}`;
    yield withRetry(`${docker} compose -f compose.yml -f compose.iperf3.yml up -d ${cts.join(" ")}`);
  }
  yield "sleep 5";
  for (const [host, docker, cts] of listContainersByHost("_c")) {
    yield `msg Starting iperf3 clients on ${host}`;
    yield withRetry(`${docker} compose -f compose.yml -f compose.iperf3.yml up -d ${cts.join(" ")}`);
  }

  yield "msg Waiting for iperf3 clients to finish";
  for (const [, docker, cts] of listContainersByHost("_c")) {
    for (const ct of cts) {
      yield `${docker} wait ${ct}`;
    }
  }

  yield "msg Gathering iperf3 statistics to 'iperf3/*.json'";
  yield "mkdir -p iperf3/";
  for (const [, docker, cts] of listContainersByHost("_c")) {
    for (const ct of cts) {
      yield `${docker} logs ${ct} | jq -s .[-1] >iperf3/${ct.slice(7)}.json`;
    }
  }

  for (const [host, docker, cts] of listContainersByHost("")) {
    yield `msg Deleting iperf3 servers and clients on ${host}`;
    yield withRetry(`${docker} rm -f ${cts.join(" ")}`);
  }
}

await file_io.write(path.join(args.dir, "iperf3.sh"), [
  "#!/bin/bash",
  ...compose.scriptHead,
  ...makeScript(),
].join("\n"));
