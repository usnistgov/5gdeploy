import DefaultMap from "mnemonist/default-map.js";
import { sortBy } from "sort-by-typescript";
import { collect, map, pipeline } from "streaming-iterables";

import { file_io, Yargs } from "../util/mod.js";
import { ctxOptions, gatherPduSessions, loadCtx } from "./common.js";

const args = Yargs()
  .option(ctxOptions)
  .parseSync();

const [c, netdef] = await loadCtx(args);

const table = await pipeline(
  () => gatherPduSessions(c, netdef),
  map((ctx) => [
    ctx.sub.supi,
    ctx.ueService.container_name,
    ctx.ueHost || "PRIMARY",
    ctx.pduIP,
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
table.push(...Array.from(counts.values(),
  ([cnt, dn]) => ["COUNT", `${cnt}`, "_", "_", dn, "_", "_"],
));

await file_io.write("-", file_io.toTable(
  ["supi", "ueCt", "ueHost", "pduIP", "snssai_dnn", "dnHost", "dnIP"],
  table,
).tui);
