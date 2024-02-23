import { Yargs } from "../../util/mod.js";
import * as sonic from "../common/sonic.js";

const args = Yargs()
  .option(sonic.makeOptions("20230817"))
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
  .option("port-upf140", {
    demandOption: true,
    desc: "UPF140 switchport",
    type: "string",
  })
  .option("port-upf141", {
    demandOption: true,
    desc: "UPF141 switchport",
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
  .option("dl-w140", {
    default: 60,
    desc: "downlink UPF140 traffic weight (1..100)",
    type: "number",
  })
  .option("dl-w141", {
    default: 20,
    desc: "downlink UPF141 traffic weight (1..100)",
    type: "number",
  })
  .parseSync();

const b = new sonic.Builder(args);
b.assignTrafficClass("upf1", args.portUpf1, 2);
b.assignTrafficClass("upf140", args.portUpf140, 1);
b.assignTrafficClass("upf141", args.portUpf141, 0);

for (const [i, gnbPort] of args.portGnb.entries()) {
  b.assignScheduler(`gnb${i}`, gnbPort, args.dlSched, args.dlGnb, {
    2: args.dlW1,
    1: args.dlW140,
    0: args.dlW141,
  });
}

await b.output();
