import path from "node:path";

import DefaultMap from "mnemonist/default-map.js";
import map from "obliterator/map.js";
import { sortBy } from "sort-by-typescript";
import { collect, parallelMap, pipeline } from "streaming-iterables";

import * as compose from "../compose/mod.js";
import type { ComposeFile } from "../types/mod.js";
import { file_io, Yargs } from "../util/mod.js";

const args = Yargs()
  .option("dir", {
    demandOption: true,
    type: "string",
  })
  .option("prefix", {
    demandOption: true,
    type: "string",
  })
  .parseSync();

const c = await file_io.readYAML(path.join(args.dir, `compose.${args.prefix}.yml`)) as ComposeFile;
const table = await pipeline(
  () => Object.values(c.services).filter((s) =>
    compose.annotate(s, "tgcs_tgid") === "iperf3" &&
    s.container_name.endsWith("_c"),
  ),
  parallelMap(16, async (s): Promise<Array<string | number>> => {
    const group = compose.annotate(s, "tgcs_group")!;
    const port = compose.annotate(s, "tgcs_port")!;
    const dn = compose.annotate(s, "tgcs_dn")!;
    const dir = compose.annotate(s, "tgcs_dir")!;
    const ue = compose.annotate(s, "tgcs_ue")!;
    try {
      const report = await file_io.readJSON(path.join(args.dir, `${args.prefix}/${group}-${port}-c.json`)) as {
        end: {
          sum: {
            sender: boolean;
            bits_per_second: number;
            lost_percent: number;
          };
          cpu_utilization_percent: {
            host_total: number;
            remote_total: number;
          };
        };
      };
      const { sum, cpu_utilization_percent: cpu } = report.end;
      return [
        group,
        dn,
        dir,
        ue,
        port,
        sum.sender ? cpu.host_total : cpu.remote_total,
        sum.sender ? cpu.remote_total : cpu.host_total,
        sum.bits_per_second / 1e6,
        sum.bits_per_second * (1 - sum.lost_percent / 100) / 1e6,
      ];
    } catch {
      return [group, dn, dir, ue, port, Number.NaN, Number.NaN, Number.NaN, Number.NaN];
    }
  }),
  collect,
);
table.sort(sortBy("0", "1", "2", "3", "4", "5"));

const sums = new DefaultMap<string, [send: number, recv: number, group: string, dn: string, dir: string]>(
  (key: string) => [0, 0, ...key.split("|")] as [number, number, string, string, string],
);
for (const row of table) {
  const [group, dn, dir] = row;
  const sum = sums.get(`${group}|${dn}|${dir}`);
  sum[0] += row.at(-2) as number;
  sum[1] += row.at(-1) as number;
}
table.push(...map(sums.values(),
  ([send, recv, group, dn, dir]) => [group, dn, dir, "TOTAL", "*", "_", "_", send, recv],
));

for (const row of table) {
  for (const [i, col] of row.entries()) {
    if (typeof col === "number" && !Number.isInteger(col)) {
      row[i] = col.toFixed(3);
    }
  }
}

const tTable = file_io.toTable(
  ["group", "snssai_dnn", "dir", "supi", "port", "send-CPU", "recv-CPU", "send-Mbps", "recv-Mbps"],
  table,
);
await file_io.write(path.join(args.dir, args.prefix, "iperf3.tsv"), tTable.tsv);
await file_io.write("-", tTable.tui);
