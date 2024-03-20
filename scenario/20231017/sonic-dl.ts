import { Yargs } from "../../util/mod.js";
import * as sonic from "../common/sonic.js";

const args = Yargs()
  .option(sonic.basicOptions("20231017dl"))
  .option("gnb", sonic.swportsOption("gNB"))
  .option("upf1", sonic.swportOption("UPF1"))
  .option("upf4", sonic.swportOption("UPF4"))
  .option("rate", {
    demandOption: true,
    desc: "rate limit toward each gNB (Mbps)",
    type: "number",
  })
  .option("sched", sonic.schedOption())
  .option("w1", sonic.weightOption("UPF1", 20))
  .option("w4", sonic.weightOption("UPF4", 80))
  .parseSync();

const b = new sonic.Builder(args);
b.assignTrafficClassUncond("upf1", args.upf1, 1);
b.assignTrafficClassUncond("upf4", args.upf4, 0);

for (const [i, gnb] of args.gnb.entries()) {
  b.assignScheduler(`gnb${i}`, gnb, args.sched, args.rate, {
    1: args.w1,
    0: args.w4,
  });
}

await b.output();
