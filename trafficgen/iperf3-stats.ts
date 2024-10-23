import path from "node:path";

import DefaultMap from "mnemonist/default-map.js";
import map from "obliterator/map.js";
import { sortBy } from "sort-by-typescript";
import { collect, parallelMap, pipeline } from "streaming-iterables";

import * as compose from "../compose/mod.js";
import iperf3Schema from "../types/iperf3.schema.json";
import type { ComposeFile, IPERF3 } from "../types/mod.js";
import { file_io, makeSchemaValidator, Yargs } from "../util/mod.js";
import { Direction } from "./tgcs-defs.js";

const validateReport: (input: unknown) => asserts input is IPERF3.Report = makeSchemaValidator<IPERF3.Report>(iperf3Schema);

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
const table = (await pipeline(
  () => Object.values(c.services).filter((s) =>
    s.container_name.endsWith("_c") &&
    compose.annotate(s, "tgcs_tgid") === "iperf3" &&
    compose.annotate(s, "tgcs_stats_ext") === ".json",
  ),
  parallelMap(16, async (s): Promise<Array<Array<string | number>>> => {
    const group = compose.annotate(s, "tgcs_group")!;
    const port = compose.annotate(s, "tgcs_port")!;
    const dn = compose.annotate(s, "tgcs_dn")!;
    const dir = compose.annotate(s, "tgcs_dir")!;
    const ue = compose.annotate(s, "tgcs_ue")!;

    let report: unknown;
    try {
      report = await file_io.readJSON(path.join(args.dir, args.prefix, `${group}-${port}-c.json`));
      validateReport(report);
    } catch {
      return [[group, dn, dir, ue, port, Number.NaN, Number.NaN, Number.NaN, Number.NaN]];
    }

    const { sum, sum_bidir_reverse: rev, cpu_utilization_percent: cpu } = report.end;
    const result: Array<Array<string | number>> = [];
    for (const row of [sum, rev]) {
      if (!row) {
        continue;
      }
      result.push([
        group,
        dn,
        row.sender ? Direction.ul : Direction.dl,
        ue,
        port,
        row.sender ? cpu.host_total : cpu.remote_total,
        row.sender ? cpu.remote_total : cpu.host_total,
        row.bits_per_second / 1e6,
        row.bits_per_second * (1 - row.lost_percent / 100) / 1e6,
      ]);
    }
    return result;
  }),
  collect,
)).flat();
table.sort(sortBy("0", "1", "2", "3", "4"));

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
