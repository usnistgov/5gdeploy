import path from "node:path";

import DefaultMap from "mnemonist/default-map.js";
import map from "obliterator/map.js";
import { sortBy } from "sort-by-typescript";

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

const table: Array<Array<string | number>> = [];

const parsers: Record<string, (filename: string, group: string, dn: string, dir: Direction, ue: string, port: number) => Promise<boolean>> = {
  "iperf2.csv": async (filename, group, dn, dir, ue, port) => {
    let sFilename = filename;
    let rFilename = filename.replace(/-c.csv$/, "-s.csv");
    switch (dir) {
      case Direction.bidir: {
        return false;
      }
      case Direction.dl: {
        [sFilename, rFilename] = [rFilename, sFilename];
        break;
      }
    }

    const sReport = await file_io.readTable(sFilename, { columns: true }) as Array<Record<string, string>>;
    const rReport = await file_io.readTable(rFilename, { columns: true }) as Array<Record<string, string>>;
    const sFinal = sReport.at(-1) ?? {};
    const rFinal = rReport.at(-1) ?? {};
    if (!(
      sFinal.transferid === rFinal.transferid &&
      sFinal.srcaddress === rFinal.srcaddress && sFinal.srcport === rFinal.srcport &&
      sFinal.dstaddr === rFinal.dstaddr && sFinal.dstport === rFinal.dstport &&
      sFinal.writecnt !== undefined && rFinal.readcnt !== undefined
    )) {
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
      Number.parseFloat(sFinal.speed ?? "NaN") / 1e6,
      Number.parseFloat(rFinal.speed ?? "NaN") / 1e6,
      rFinal.ttavg === undefined ? "_" : Number.parseFloat(rFinal.ttavg),
    ]);

    return true;
  },
  "iperf3.json": async (filename, group, dn, dir, ue, port) => {
    const report = await file_io.readJSON(filename);
    try {
      validateReport(report);
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
        row.sender ? Direction.ul : Direction.dl,
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
    table.push([group, dn, dir, ue, port, Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
  }
}
table.sort(sortBy("0", "1", "2", "3", "4"));

const sums = new DefaultMap<string, [send: number, recv: number, group: string, dn: string, dir: string]>(
  (key: string) => [0, 0, ...key.split("|")] as [number, number, string, string, string],
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
