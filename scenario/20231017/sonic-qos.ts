import { Yargs } from "../../util/mod.js";
import * as sonic from "../common/sonic.js";

const args = Yargs()
  .option(sonic.basicOptions("20231017"))
  .option("port-gnb", {
    demandOption: true,
    desc: "gNB switchport(s)",
    string: true,
    type: "array",
  })
  .option("port-upf1", {
    demandOption: true,
    desc: "UPF1 switchport",
    type: "string",
  })
  .option("port-upf4", {
    demandOption: true,
    desc: "UPF4 switchport",
    type: "string",
  })
  .option("dl-gnb", {
    demandOption: true,
    desc: "downlink rate limit per gNB (Mbps)",
    type: "number",
  })
  .option("dl-sched", sonic.schedOption("downlink"))
  .option("dl-w1", {
    default: 20,
    desc: "downlink UPF1 traffic weight (1..100)",
    type: "number",
  })
  .option("dl-w4", {
    default: 80,
    desc: "downlink UPF4 traffic weight (1..100)",
    type: "number",
  })
  .parseSync();

const b = new sonic.Builder(args);
b.assignTrafficClassUncond("upf1", args.portUpf1, 1);
b.assignTrafficClassUncond("upf4", args.portUpf4, 0);

for (const [i, gnbPort] of args.portGnb.entries()) {
  b.assignScheduler(`gnb${i}`, gnbPort, args.dlSched, args.dlGnb, {
    1: args.dlW1,
    0: args.dlW4,
  });
}

await b.output();
