import { parse as csvParse } from "csv/sync";
import type { LinkInfo } from "iproute";
import { Minimatch } from "minimatch";
import { DefaultMap } from "mnemonist";
import { sortBy } from "sort-by-typescript";
import { collect, flatMap, flatTransform, map, pipeline } from "streaming-iterables";
import type { SetOptional } from "type-fest";

import * as compose from "../compose/mod.js";
import { dockerode, file_io, splitVbar, Yargs, YargsCoercedArray } from "../util/mod.js";
import { ctxOptions, loadCtx, tableOutput, tableOutputOptions } from "./common.js";

type LinkInfo64 = SetOptional<LinkInfo, "stats"> & {
  stats64?: LinkInfo["stats"];
};

interface Rule {
  net: Minimatch;
  ethStats: boolean;
}

const args = Yargs()
  .option(ctxOptions)
  .option(tableOutputOptions)
  .option("link", YargsCoercedArray({
    coerce(line): { ct: string } & Rule {
      const [ct, net, opts = ""] = splitVbar("link", line, 2, 3);
      return {
        ct,
        net: new Minimatch(net),
        ethStats: opts.includes("#eth"),
      };
    },
    default: "*|*",
    desc: "link matcher and options",
  }))
  .option("sort-by", {
    choices: ["ct", "net"],
    default: "ct",
    desc: "report sort order",
    type: "string",
  })
  .parseSync();

const [c] = await loadCtx(args);

const netnsRules = new DefaultMap<string, Rule[]>(() => []);
for (const { ct, ...rule } of args.link) {
  if (ct.startsWith("host:")) {
    netnsRules.get(`/${ct.slice(5)}`).push(rule);
  } else if (ct.startsWith("host-of:")) {
    const ctP = new Minimatch(ct.slice(8));
    for (const s of Object.values(c.services)) {
      if (ctP.match(s.container_name)) {
        netnsRules.get(`/${compose.annotate(s, "host") ?? ""}`).push(rule);
      }
    }
  } else {
    const ctP = new Minimatch(ct);
    for (const s of Object.values(c.services)) {
      if (!compose.annotate(s, "every_host") && s.network_mode === undefined && ctP.match(s.container_name)) {
        netnsRules.get(s.container_name).push(rule);
      }
    }
  }
}

function ctnsExec(ct: string, command: readonly string[]): Promise<dockerode.execCommand.Result> {
  let host: string | undefined;
  if (ct.startsWith("/")) {
    host = ct.slice(1);
    ct = "bridge";
  } else {
    host = compose.annotate(c.services[ct]!, "host");
    if (c.services.bridge) {
      command = ["ctns.sh", ct, ...command];
      ct = "bridge";
    }
  }
  return dockerode.execCommand(dockerode.getContainer(ct, host), command);
}

const table = await pipeline(
  () => netnsRules.entries(),
  flatTransform(16, async function*([ct, rules]) {
    try {
      const exec = await ctnsExec(ct, ["ip", "-j", "-s", "link", "show"]);
      const links = JSON.parse(exec.stdout) as LinkInfo64[];
      yield { ct, links, rules };
    } catch {}
  }),
  flatTransform(16, async function*({ ct, links, rules }) {
    for (const { ifname, stats64, stats = stats64, txqlen } of links) {
      let wantStats = false;
      let wantEthStats = false;
      for (const { net, ethStats } of rules) {
        if (net.match(ifname)) {
          wantStats ||= true;
          wantEthStats ||= ethStats;
        }
      }
      if (!wantStats || !stats) {
        continue;
      }

      // every physical NIC has a non-zero txqlen value; dummy/bridge NIC does not have this field
      let ethStats: ReadonlyArray<[string, number]> | undefined;
      if (txqlen && wantEthStats) {
        const exec = await ctnsExec(ct, ["ethtool", "-S", ifname]);
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
        }) as unknown as ReadonlyArray<[string, number]>;
      }

      yield { ct, ifname, stats, ethStats };
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
