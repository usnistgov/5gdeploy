import path from "node:path";

import { DefaultMap } from "mnemonist";
import map from "obliterator/map.js";
import { sortBy } from "sort-by-typescript";
import type { SetRequired } from "type-fest";

import * as compose from "../compose/mod.js";
import iperf3Schema from "../types/iperf3.schema.json";
import type { ComposeFile, IPERF3 } from "../types/mod.js";
import { assert, file_io, makeSchemaValidator, Yargs } from "../util/mod.js";
import { Direction } from "./tgcs-defs.js";

namespace iperf2csv {
  const requiredCols = ["transferid", "speed", "istart", "iend"] as const;
  const intCols = ["transferid", "speed", "writecnt", "readcnt", "ttcnt"] as const;
  const floatCols = ["istart", "iend", "ttavg", "ttmin", "ttmax", "ttsdev"] as const;

  export type Row = Record<string, string> & SetRequired<
  Partial<Record<typeof intCols[number] | typeof floatCols[number], number>>,
  typeof requiredCols[number]>;

  export async function readTable(filename: string): Promise<Row[]> {
    const table = await file_io.readTable(filename, {
      cast(value, { column }) {
        if (intCols.includes(column as any)) {
          return Number.parseInt(value, 10);
        }
        if (floatCols.includes(column as any)) {
          return Number.parseFloat(value);
        }
        return value;
      },
      columns: true,
    }) as Row[];
    assert(table.length > 0, "empty CSV");
    for (const col of requiredCols) {
      assert(table[0]![col] !== undefined, `missing column ${col}`);
    }
    return table;
  }

  export function gatherLatency(rReport: readonly Row[]): number | undefined {
    const rFinal = rReport.at(-1)!;
    if (rFinal.transferid > 0) {
      return rFinal.ttavg;
    }
    if (rFinal.ttcnt !== -1) {
      return undefined;
    }
    const ttavgs: number[] = [];
    for (const rRow of rReport) {
      if (rRow.istart === rFinal.istart && rRow.iend === rFinal.iend && rRow.transferid > 0 &&
        (rRow.ttcnt ?? 0) > 0 && rRow.ttavg !== undefined) {
        ttavgs.push(rRow.ttavg);
      }
    }
    if (ttavgs.length === 0) {
      return undefined;
    }
    ttavgs.sort((a, b) => a - b);
    const medianIndex = Math.floor((ttavgs.length - 1) / 2);
    return ttavgs.length % 2 === 0 ? (ttavgs[medianIndex]! + ttavgs[medianIndex + 1]!) / 2 : ttavgs[medianIndex]!;
  }
}

const iperf3Validate: (input: unknown) => asserts input is IPERF3.Report = makeSchemaValidator<IPERF3.Report>(iperf3Schema);

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

const table: Array<Array<string | number>> = [];

const parsers: Record<string, (filename: string, group: string, dn: string, dir: Direction, ue: string, port: number) => Promise<boolean>> = {
  "iperf2.csv": async (filename, group, dn, dir, ue, port) => {
    if (dir === Direction.bidir) {
      return false;
    }
    let clientReport: iperf2csv.Row[];
    let serverReport: iperf2csv.Row[];
    try {
      [clientReport, serverReport] = await Promise.all([
        iperf2csv.readTable(filename),
        iperf2csv.readTable(filename.replace(/-c.csv$/, "-s.csv")),
      ]);
    } catch {
      return false;
    }
    const [sReport, rReport] = clientReport[0]!.writecnt !== undefined && serverReport[0]!.readcnt !== undefined ?
      [clientReport, serverReport] : [serverReport, clientReport];
    const sFinal = sReport.at(-1)!;
    const rFinal = rReport.at(-1)!;
    if (sFinal.transferid !== rFinal.transferid || sFinal.writecnt === undefined || rFinal.readcnt === undefined) {
      return false;
    }

    table.push([
      group,
      dn,
      dir,
      ue,
      port,
      "_",
      "_",
      (sFinal.speed ?? 0) / 1e6,
      (rFinal.speed ?? 0) / 1e6,
      iperf2csv.gatherLatency(rReport) ?? "_",
    ]);

    return true;
  },
  "iperf3.json": async (filename, group, dn, dir, ue, port) => {
    const report = await file_io.readJSON(filename);
    try {
      iperf3Validate(report);
    } catch {
      return false;
    }
    void dir;

    const { sum, sum_bidir_reverse: rev, cpu_utilization_percent: cpu } = report.end;
    for (const row of [sum, rev]) {
      if (!row) {
        continue;
      }
      table.push([
        group,
        dn,
        row.sender ? Direction.ul : Direction.dl, // XXX incompatible with #R reverse direction
        ue,
        port,
        row.sender ? cpu.host_total : cpu.remote_total,
        row.sender ? cpu.remote_total : cpu.host_total,
        row.bits_per_second / 1e6,
        row.bits_per_second * (1 - row.lost_percent / 100) / 1e6,
        "_",
      ]);
    }
    return true;
  },
};

const c = await file_io.readYAML(path.join(args.dir, `compose.${args.prefix}.yml`)) as ComposeFile;
for (const s of Object.values(c.services).filter(({ container_name: ct }) => /_iperf[23]_\d+_\d+_c$/.test(ct))) {
  const tgid = compose.annotate(s, "tgcs_tgid")!;
  const statsExt = compose.annotate(s, "tgcs_stats_ext") ?? ".log";
  const group = compose.annotate(s, "tgcs_group")!;
  const dn = compose.annotate(s, "tgcs_dn")!;
  const dir = compose.annotate(s, "tgcs_dir") as Direction;
  const ue = compose.annotate(s, "tgcs_ue")!;
  const port = Number.parseInt(compose.annotate(s, "tgcs_port")!, 10);

  if (!await parsers[`${tgid}${statsExt}`]?.(
    path.join(args.dir, args.prefix, `${group}-${port}-c${statsExt}`),
    group, dn, dir, ue, port,
  )) {
    table.push([group, dn, dir, ue, port, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
  }
}
table.sort(sortBy("0", "1", "2", "3", "4"));

const sums = new DefaultMap(
  (key: string) => [0, 0, ...key.split("|")] as [send: number, recv: number, group: string, dn: string, dir: string],
);
for (const row of table) {
  const [group, dn, dir] = row;
  const sum = sums.get([group, dn, dir].join("|"));
  sum[0] += row.at(7) as number;
  sum[1] += row.at(8) as number;
}
table.push(...map(sums.values(),
  ([send, recv, group, dn, dir]) => [group, dn, dir, "TOTAL", "*", "_", "_", send, recv, "_"],
));

for (const row of table) {
  for (const [i, col] of row.entries()) {
    if (typeof col === "number" && !Number.isInteger(col)) {
      row[i] = col.toFixed(3);
    }
  }
}

const tTable = file_io.toTable(
  ["group", "snssai_dnn", "dir", "supi", "port", "send-CPU", "recv-CPU", "send-Mbps", "recv-Mbps", "latency"],
  table,
);
await file_io.write(path.join(args.dir, args.prefix, "iperf.tsv"), tTable.tsv);
await file_io.write("-", tTable.tui);
