import DefaultMap from "mnemonist/default-map.js";
import oblMap from "obliterator/map.js";
import { sortBy } from "sort-by-typescript";
import { collect, map, pipeline } from "streaming-iterables";

import { file_io, Yargs } from "../util/mod.js";
import { ctxOptions, gatherPduSessions, loadCtx, tableOutput, tableOutputOptions } from "./common.js";

const args = Yargs()
  .option(ctxOptions)
  .option(tableOutputOptions)
  .parseSync();

const [c, netdef] = await loadCtx(args);

const table = await pipeline(
  () => gatherPduSessions(c, netdef),
  map((ctx) => [
    ctx.sub.supi,
    ctx.ueService.container_name,
    ctx.ueHost || "PRIMARY",
    ctx.pduIP,
    ctx.pduNetif,
    `${ctx.dn.snssai}_${ctx.dn.dnn}`,
    ctx.dnHost || "PRIMARY",
    ctx.dnIP,
  ]),
  collect,
);
table.sort(sortBy("4", "0"));

const counts = new DefaultMap<string, [cnt: number, dn: string]>((dn: string) => [0, dn]);
for (const row of table) {
  const dn = row[4]!;
  counts.get(dn)[0] += 1;
}
table.push(...oblMap(counts.values(),
  ([cnt, dn]) => ["COUNT", `${cnt}`, "_", "_", "_", dn, "_", "_"],
));

await tableOutput(args, file_io.toTable(
  ["supi", "ueCt", "ueHost", "pduIP", "pduNetif", "snssai_dnn", "dnHost", "dnIP"],
  table,
));
