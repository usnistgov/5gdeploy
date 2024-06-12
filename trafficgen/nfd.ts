import path from "node:path";

import { Minimatch } from "minimatch";
import * as shlex from "shlex";
import { consume, filter, map, pipeline } from "streaming-iterables";

import * as compose from "../compose/mod.js";
import type { ComposeService } from "../types/compose.js";
import { cmdOptions, cmdOutput, file_io, Yargs } from "../util/mod.js";
import { copyPlacementNetns, ctxOptions, gatherPduSessions, loadCtx } from "./common.js";

const nfdDockerImage = "ghcr.io/named-data/nfd";

const args = Yargs()
  .option(ctxOptions)
  .option(cmdOptions)
  .option("dnn", {
    coerce(arg: string) {
      return new Minimatch(arg);
    },
    demandOption: true,
    desc: "Data Network Name (minimatch pattern)",
    type: "string",
  })
  .parseSync();

const [c, netdef] = await loadCtx(args);

const output = compose.create();
const nfdDN = new Map<string, {
  server: ComposeService;
}>();
const routeCommands = new Map<string, {
  dnIP: string;
  pduNetif: string;
}>();

await pipeline(
  () => gatherPduSessions(c, netdef),
  filter(({ dn: { dnn } }) => args.dnn.match(dnn)),
  map((ctx) => {
    const { ueService, dn: { dnn }, dnService, dnIP, pduNetif } = ctx;

    const client = compose.defineService(output, ueService.container_name.replace(/^ue/, "nfd"), nfdDockerImage);
    copyPlacementNetns(client, ueService);
    client.healthcheck = {
      test: ["CMD-SHELL", `echo ${shlex.quote([
        `face create udp4://${dnIP} persistency permanent`,
        `route add / udp4://${dnIP}`,
      ].join("\n"))} | nfdc --batch -`],
      start_period: "30s",
      start_interval: "5s",
    };
    routeCommands.set(ueService.container_name, { dnIP, pduNetif });

    if (!nfdDN.has(dnn)) {
      const server = compose.defineService(output, dnService.container_name.replace(/^dn/, "nfd"), nfdDockerImage);
      copyPlacementNetns(server, dnService);
      nfdDN.set(dnn, { server });
      server.healthcheck = {
        test: ["CMD", "nfdc", "status", "show"],
        start_period: "30s",
        start_interval: "5s",
      };
    }
  }),
  consume,
);

await file_io.write(path.join(args.dir, "compose.nfd.yml"), output);

await cmdOutput(args, (function*() {
  yield `cd ${shlex.quote(args.dir)}`;

  for (const { hostDesc, dockerH, names } of compose.classifyByHost(c, (ct) => routeCommands.has(ct))) {
    yield `msg Setting IP routes on ${hostDesc}`;
    for (const ct of names) {
      const { dnIP, pduNetif } = routeCommands.get(ct)!;
      yield `${dockerH} exec ${ct} ip route replace ${dnIP}/32 dev ${pduNetif}`;
    }
  }

  for (const { hostDesc, dockerH, names } of compose.classifyByHost(output)) {
    yield `msg Starting NFD on ${hostDesc}`;
    yield `with_retry ${dockerH} compose -f compose.yml -f compose.nfd.yml up -d ${names.join(" ")}`;
  }
})());
