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
  .option("net", {
    defaultDescription: "networks defined in the Compose file",
    desc: "selected networks (minimatch pattern, 'ALL' for all network interfaces including 'lo' and PDU sessions)",
    type: "string",
  })
  .parseSync();

const [c] = await loadCtx(args);

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
  filter((s: ComposeService) => !compose.annotate(s, "every_host") && s.network_mode === undefined),
  flatTransform(16, async function*(s) {
    try {
      const ct = dockerode.getContainer(s.container_name, compose.annotate(s, "host"));
      const exec = await dockerode.execCommand(ct, ["ip", "-j", "-s", "link", "show"]);
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
table.sort(sortBy("0", "1"));

await tableOutput(args, file_io.toTable(
  ["ct", "net", "rx-pkts", "tx-pkts"],
  table,
));
