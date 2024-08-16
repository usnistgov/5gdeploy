import path from "node:path";

import { Netmask } from "netmask";
import * as shlex from "shlex";
import { consume, filter, map, pipeline } from "streaming-iterables";

import * as compose from "../compose/mod.js";
import type { ComposeService } from "../types/mod.js";
import { assert, cmdOptions, cmdOutput, file_io, Yargs } from "../util/mod.js";
import { copyPlacementNetns, ctxOptions, gatherPduSessions, loadCtx, toNfdName } from "./common.js";

const nfdDockerImage = "ghcr.io/named-data/nfd";

const args = Yargs()
  .option(ctxOptions)
  .option(cmdOptions)
  .option("dnn", {
    demandOption: true,
    desc: "Data Network Name",
    type: "string",
  })
  .option("mtu", {
    default: 1200,
    desc: "UDP face MTU",
    type: "number",
  })
  .option("server", {
    coerce(arg: string) {
      return new Netmask(`${arg}/32`);
    },
    defaultDescription: "launch NFD instance in DN netns",
    desc: "DN side NFD IPv4 address",
    type: "string",
  })
  .parseSync();

const [c, netdef] = await loadCtx(args);

const dn = netdef.findDN(args.dnn);
assert(dn !== undefined, `Data Network ${args.dnn} not found`);
assert(dn.type === "IPv4", `Data Network ${args.dnn} is not IPv4`);

const output = compose.create();
let server: ComposeService | undefined;
const routeCommands = new Map<string, [dst: Netmask, dev: string]>();

function defineNfdService(netns: ComposeService): ComposeService {
  const name = toNfdName(netns);
  const s = compose.defineService(output, name, nfdDockerImage);
  compose.setCommands(s, [
    `sed -i '/unicast_mtu/ s/8800/${args.mtu}/' /config/nfd.conf`,
    "nfd --config /config/nfd.conf",
  ]);
  copyPlacementNetns(s, netns);

  output.volumes[name] = { name };
  s.volumes.push({
    type: "volume",
    source: name,
    target: "/run/nfd",
  });

  return s;
}

function defineServer(dnService: ComposeService): ComposeService {
  const s = defineNfdService(dnService);
  s.healthcheck = {
    test: ["CMD", "nfdc", "status", "show"],
    start_period: "30s",
    start_interval: "5s",
  };
  return s;
}

await pipeline(
  () => gatherPduSessions(c, netdef),
  filter(({ dn: { dnn } }) => dnn === dn.dnn),
  map((ctx) => {
    const { ueService, dnService, dnIP, pduNetif } = ctx;

    let remote: Netmask;
    if (args.server) {
      remote = args.server;
    } else {
      remote = new Netmask(`${dnIP}/32`);
      server ??= defineServer(dnService);
    }

    const client = defineNfdService(ueService);
    client.healthcheck = {
      test: ["CMD-SHELL", `echo ${shlex.quote([
        `face create udp4://${remote.base} persistency permanent mtu ${args.mtu}`,
        `route add / udp4://${remote.base}`,
      ].join("\n"))} | nfdc --batch -`],
      interval: "60s",
      start_period: "60s",
      start_interval: "5s",
    };
    routeCommands.set(ueService.container_name, [remote, pduNetif]);
  }),
  consume,
);

await file_io.write(path.join(args.dir, "compose.nfd.yml"), output);

await cmdOutput(args, (function*() {
  yield `cd ${shlex.quote(args.dir)}`;

  for (const { hostDesc, dockerH, names } of compose.classifyByHost(c, (ct) => routeCommands.has(ct))) {
    yield `msg Setting IP routes on ${hostDesc}`;
    for (const ct of names) {
      const [dst, dev] = routeCommands.get(ct)!;
      yield `${dockerH} exec ${ct} ip route replace ${dst} dev ${dev}`;
    }
  }

  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output)) {
    yield `msg Starting NFD on ${hostDesc}`;
    yield `with_retry env COMPOSE_IGNORE_ORPHANS=1 ${dockerH} compose -f compose.nfd.yml up -d ${names.join(" ")}`;
  }
})());
