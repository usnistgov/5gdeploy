import { parse as csvParse } from "csv/sync";

import { validateNetDef } from "../netdef/netdef.js";
import type { N } from "../types/mod.js";
import { decPad, file_io, Yargs } from "../util/mod.js";

const args = Yargs()
  .option("netdef", {
    demandOption: true,
    desc: "network definition file",
    type: "string",
  })
  .option("sims", {
    demandOption: true,
    desc: "SIM cards table",
    normalize: true,
    type: "string",
  })
  .parseSync();

const sims = csvParse(await file_io.readText(args.sims), {
  columns: ["supi", "k", "opc"],
  comment: "#",
  delimiter: [",", " ", "\t"],
  skipEmptyLines: true,
  trim: true,
}) as Array<Required<Pick<N.Subscriber, "supi" | "k" | "opc">>>;

const network = await file_io.readJSON(args.netdef) as N.Network;
validateNetDef(network);

if (sims.length > 0) {
  const { supi } = sims[0]!;
  network.plmn = `${supi.slice(0, 3)}-${supi.slice(3, 5)}`; // assume 2-digit MNC
}

network.subscribers = network.subscribers.flatMap((sub) => {
  const replaced: N.Subscriber[] = [];
  let supi = BigInt(sub.supi);
  sub.count ??= 1;

  while (sub.count > 0 && sims.length > 0) {
    replaced.push({
      ...sub,
      count: 1,
      ...sims.shift(),
    });
    sub.supi = decPad(++supi, 15);
    --sub.count;
  }

  if (sub.count > 0) {
    replaced.push(sub);
  }
  return replaced;
});

await file_io.write(args.netdef, network);
