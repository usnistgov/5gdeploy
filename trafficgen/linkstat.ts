import { parse as csvParse } from "csv/sync";
import type { LinkInfo } from "iproute";
import { Minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
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
  .option("queues", {
    default: "NEVER",
    desc: "selected networks to obtain queue counters",
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
if (args.net) {
  const networksPattern = new Minimatch(args.net.replace(/^ALL$/, "*"));
  networksMatcher = (net) => networksPattern.match(net);
} else {
  networksMatcher = (net) => !!c.networks[net];
}

const queuesMatcher = new Minimatch(args.queues);

const table = await pipeline(
  () => Object.values(c.services),
  filter((s: ComposeService) => !compose.annotate(s, "every_host") &&
   ctMatcher.match(s.container_name) && s.network_mode === undefined),
  flatTransform(16, async function*(s) {
    try {
      const exec = await ctnsExec(s, ["ip", "-j", "-s", "link", "show"]);
      const links = JSON.parse(exec.stdout) as LinkInfo64[];
      yield { s, links };
    } catch {}
  }),
  flatTransform(16, async function*({ s, links }) {
    for (const { ifname, stats64, stats = stats64, txqlen } of links) {
      if (!stats || !networksMatcher(ifname)) {
        continue;
      }

      let ethStats: ReadonlyArray<[string, number]> | undefined;
      // every physical NIC has a non-zero txqlen value; dummy/bridge NIC does not have this field
      if (queuesMatcher.match(ifname) && txqlen) {
        const exec = await ctnsExec(s, ["ethtool", "-S", ifname]);
        ethStats = csvParse(exec.stdout, {
          cast(value, { column }) {
            switch (column) {
              case 0: {
                return value.replace(/:$/, "");
              }
              case 1: {
                return Number.parseInt(value, 10);
              }
            }
            return value;
          },
          delimiter: ":",
          trim: true,
          ltrim: true,
          rtrim: true,
        });
      }

      yield { ct: s.container_name, ifname, stats, ethStats };
    }
  }),
  flatMap(function*({ ct, ifname, stats, ethStats = [] }) {
    yield { row: [ct, ifname, "_", stats.rx.packets, stats.tx.packets] };

    const queues = new DefaultMap<number, [number, number]>(() => [Number.NaN, Number.NaN]);
    for (const [index, regex] of [
      [0, /^rx-?(\d+)[_.]packets$/],
      [1, /^tx-?(\d+)[_.]packets$/],
    ] as const) {
      for (const [cnt, value] of ethStats) {
        const m = cnt.match(regex);
        if (m) {
          queues.get(Number.parseInt(m[1]!, 10))[index] = value;
        }
      }
    }
    for (let q = 0; ; ++q) {
      const tuple = queues.peek(q);
      if (!tuple || tuple.some((v) => Number.isNaN(v))) {
        break;
      }
      yield { row: [ct, ifname, q, ...tuple] };
    }
  }),
  map(({ row }) => row),
  collect,
);
switch (args["sort-by"]) {
  case "ct": {
    table.sort(sortBy("0", "1", "2"));
    break;
  }
  case "net": {
    table.sort(sortBy("1", "0", "2"));
    break;
  }
}

await tableOutput(args, file_io.toTable(
  ["ct", "net", "queue", "rx-pkts", "tx-pkts"],
  table,
));
