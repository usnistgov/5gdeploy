import { Yargs } from "../../util/mod.js";
import * as sonic from "../common/sonic.js";

const args = Yargs()
  .option(sonic.basicOptions("20230817dl"))
  .option("gnb", sonic.swportsOption("gNB"))
  .option("upf1", sonic.swportOption("UPF1"))
  .option("upf140", sonic.swportOption("UPF140"))
  .option("upf141", sonic.swportOption("UPF141"))
  .option("rate", {
    demandOption: true,
    desc: "rate limit toward each gNB (Mbps)",
    type: "number",
  })
  .option("sched", sonic.schedOption())
  .option("w1", {
    default: 20,
    desc: "UPF1 traffic weight (1..100)",
    type: "number",
  })
  .option("w140", {
    default: 60,
    desc: "UPF140 traffic weight (1..100)",
    type: "number",
  })
  .option("w141", {
    default: 20,
    desc: "UPF141 traffic weight (1..100)",
    type: "number",
  })
  .parseSync();

const b = new sonic.Builder(args);
b.assignTrafficClassUncond("upf1", args.upf1, 2);
b.assignTrafficClassUncond("upf140", args.upf140, 1);
b.assignTrafficClassUncond("upf141", args.upf141, 0);

for (const [i, gnb] of args.gnb.entries()) {
  b.assignScheduler(`gnb${i}`, gnb, args.sched, args.rate, {
    2: args.w1,
    1: args.w140,
    0: args.w141,
  });
}

await b.output();
