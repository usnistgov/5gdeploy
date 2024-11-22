import type { LinkInfo } from "iproute";
import { Minimatch } from "minimatch";
import { sortBy } from "sort-by-typescript";
import { collect, filter, flatMap, flatTransform, map, pipeline } from "streaming-iterables";
import type { SetOptional } from "type-fest";

import * as compose from "../compose/mod.js";
import type { ComposeService } from "../types/mod.js";
import { dockerode, file_io, Yargs } from "../util/mod.js";
import { ctxOptions, loadCtx, tableOutput, tableOutputOptions } from "./common.js";

type LinkInfo64 = SetOptional<LinkInfo, "stats"> & {
  stats64?: LinkInfo["stats"];
};

const args = Yargs()
  .option(ctxOptions)
  .option(tableOutputOptions)
  .option("ct", {
    default: "*",
    desc: "selected containers (minimatch pattern)",
    type: "string",
  })
  .option("net", {
    defaultDescription: "networks defined in the Compose file",
    desc: "selected networks (minimatch pattern, 'ALL' for all network interfaces including 'lo' and PDU sessions)",
    type: "string",
  })
  .option("sort-by", {
    choices: ["ct", "net"],
    default: "ct",
    desc: "report sort order",
    type: "string",
  })
  .parseSync();

const [c] = await loadCtx(args);

function ctnsExec(s: ComposeService, command: readonly string[]): Promise<dockerode.execCommand.Result> {
  let containerName = s.container_name;
  if (c.services.bridge) {
    containerName = "bridge";
    command = ["ctns.sh", s.container_name, ...command];
  }
  const ct = dockerode.getContainer(containerName, compose.annotate(s, "host"));
  return dockerode.execCommand(ct, command);
}

const ctMatcher = new Minimatch(args.ct);

let networksMatcher: (net: string) => boolean;
if (args.net === undefined) {
  networksMatcher = (net) => !!c.networks[net];
} else if (args.net === "ALL") {
  networksMatcher = () => true;
} else {
  const networksPattern = new Minimatch(args.net);
  networksMatcher = (net) => networksPattern.match(net);
}

const table = await pipeline(
  () => Object.values(c.services),
  filter((s: ComposeService) => !compose.annotate(s, "every_host") &&
   ctMatcher.match(s.container_name) && s.network_mode === undefined),
  flatTransform(16, async function*(s) {
    try {
      const exec = await ctnsExec(s, ["ip", "-j", "-s", "link", "show"]);
      const links = JSON.parse(exec.stdout) as LinkInfo64[];
      yield { ct: s.container_name, links };
    } catch {}
  }),
  flatMap(function*({ ct, links }) {
    for (const link of links) {
      const stats = link.stats ?? link.stats64;
      if (stats && networksMatcher(link.ifname)) {
        yield { row: [ct, link.ifname, stats.rx.packets, stats.tx.packets] };
      }
    }
  }),
  map(({ row }) => row),
  collect,
);
switch (args["sort-by"]) {
  case "ct": {
    table.sort(sortBy("0", "1"));
    break;
  }
  case "net": {
    table.sort(sortBy("1", "0"));
    break;
  }
}

await tableOutput(args, file_io.toTable(
  ["ct", "net", "rx-pkts", "tx-pkts"],
  table,
));
