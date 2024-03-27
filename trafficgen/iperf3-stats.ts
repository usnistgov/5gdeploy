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
    desc: "Compose context directory",
    type: "string",
  })
  .option("prefix", {
    default: "iperf3",
    desc: "container name prefix",
    type: "string",
  })
  .parseSync();

const c = await file_io.readYAML(path.join(args.dir, `compose.${args.prefix}.yml`)) as ComposeFile;
const table = await pipeline(
  () => Object.values(c.services).filter((s) =>
    s.container_name.startsWith(`${args.prefix}_`) && s.container_name.endsWith("_c") &&
    compose.annotate(s, "pduperf_mode") === "iperf3",
  ),
  parallelMap(16, async (s): Promise<Array<string | number>> => {
    const port = compose.annotate(s, "pduperf_port")!;
    const dn = compose.annotate(s, "pduperf_dn")!;
    const dir = compose.annotate(s, "pduperf_dir")!;
    const ue = compose.annotate(s, "pduperf_ue")!;
    try {
      const report = await file_io.readJSON(path.join(args.dir, `${args.prefix}/${port}_c.json`)) as {
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
      return [dn, dir, ue, port, Number.NaN, Number.NaN, Number.NaN, Number.NaN];
    }
  }),
  collect,
);
table.sort(sortBy("0", "1", "2", "3", "4"));

const sums = new DefaultMap<string, [sum: number, dir: string, dn: string]>(
  (key: string) => [0, ...key.split("|")] as [number, string, string],
);
for (const row of table) {
  const [dn, dir] = row;
  const recv = row.at(-1);
  sums.get(`${dir}|${dn}`)[0] += recv as number;
}
table.push(...map(sums.values(),
  ([value, dir, dn]) => [dn, dir, "TOTAL", "*", "_", "_", "_", value],
));

for (const row of table) {
  for (const [i, col] of row.entries()) {
    if (typeof col === "number" && !Number.isInteger(col)) {
      row[i] = Math.trunc(col * 1e3) / 1e3;
    }
  }
}

const tTable = file_io.toTable(
  ["snssai_dnn", "dir", "supi", "port", "send-CPU", "recv-CPU", "send-Mbps", "recv-Mbps"],
  table,
);
await file_io.write(path.join(args.dir, `${args.prefix}.tsv`), tTable.tsv);
await file_io.write("-", tTable.tui);
