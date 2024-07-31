
import { assert, Yargs } from "../../util/mod.js";
import * as sonic from "../common/sonic.js";

const args = Yargs()
  .option(sonic.basicOptions("20230817ul"))
  .option("gnb", sonic.swportsOption("gNB"))
  .option("n3", sonic.swportsOption("N3 main"))
  .option("rate", {
    demandOption: true,
    desc: "rate limit from each gNB (Mbps)",
    type: "number",
  })
  .option("sched", sonic.schedOption())
  .option("w1", sonic.weightOption("UPF1", 20))
  .option("w140", sonic.weightOption("UPF140", 60))
  .option("w141", sonic.weightOption("UPF141", 20))
  .check(({ gnb, n3 }) => {
    assert(gnb.length === n3.length, "gNB quantity and N3 quantity must be same");
    return true;
  })
  .parseSync();

const b = new sonic.Builder(args);
for (const [i, gnb] of args.gnb.entries()) {
  b.assignTrafficClassDSCP(`gnb${i}`, gnb, {
    8: 2,
    32: 1,
    40: 0,
  });
  b.assignScheduler(`n3u${i}`, args.n3[i]!, args.sched, args.rate, {
    2: args.w1,
    1: args.w140,
    0: args.w141,
  });
}

await b.output();
