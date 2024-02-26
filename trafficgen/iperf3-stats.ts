import path from "node:path";

import { stringify as csv } from "csv-stringify/sync";
import DefaultMap from "mnemonist/default-map.js";
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
  .parseSync();

const c = await file_io.readYAML(path.join(args.dir, "compose.iperf3.yml")) as ComposeFile;
const table = await pipeline(
  () => Object.values(c.services).filter((s) => /^iperf3_\d+_c$/.test(s.container_name)),
  parallelMap(16, async (s): Promise<Array<string | number>> => {
    const port = compose.annotate(s, "iperf3_port")!;
    const dn = compose.annotate(s, "iperf3_dn")!;
    const dir = compose.annotate(s, "iperf3_dir")!;
    const ue = compose.annotate(s, "iperf3_ue")!;
    try {
      const report = await file_io.readJSON(path.join(args.dir, `iperf3/${port}_c.json`)) as {
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

const sums = new DefaultMap<string, [number, string, string]>(
  (key: string) => [0, ...key.split("|")] as [number, string, string],
);
for (const row of table) {
  const [dn, dir] = row;
  const recv = row.at(-1);
  sums.get(`${dir}|${dn}`)[0] += recv as number;
}
table.push(...Array.from(sums.values(),
  ([value, dir, dn]) => [dn, dir, "TOTAL", "*", "_", "_", "_", value]),
);

await file_io.write(
  path.join(args.dir, "iperf3.tsv"),
  csv(table.map((row) => row.map((col) => {
    if (typeof col === "number" && !Number.isInteger(col)) {
      return Math.trunc(col * 1e3) / 1e3;
    }
    return col;
  })), {
    delimiter: "\t",
    header: true,
    columns: ["snssai_dnn", "dir", "supi", "port", "send-CPU", "recv-CPU", "send-Mbps", "recv-Mbps"],
  }),
);
