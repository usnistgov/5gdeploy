import assert from "minimalistic-assert";

import { Yargs } from "../../util/mod.js";
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
  .check(({ gnb, n3 }) => {
    assert.equal(gnb.length, n3.length, "gNB quantity and N3 quantity must be same");
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
