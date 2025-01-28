import type { N } from "../../types/mod.js";
import { file_io, Yargs, YargsIntRange } from "../../util/mod.js";

const network: N.Network = {
  plmn: "001-01",
  gnbIdLength: 24,
  tac: "000005",
  subscribers: [],
  gnbs: [],
  upfs: [
    { name: "upf0" },
  ],
  dataNetworks: [],
  dataPaths: [],
};

function defineDnns(snssai: N.SNSSAI, dnnPrefix: string, subnetBase: number, upf: string, cnt: number): N.SubscriberSNSSAI[] {
  const dnns: string[] = [];
  const subscriberNSSAI: N.SubscriberSNSSAI[] = [];
  let dnn = dnnPrefix;
  for (let j = 0; j < cnt; ++j) {
    if (cnt > 1) {
      dnn += j;
    }
    dnns.push(dnn);
    network.dataNetworks.push({ snssai, dnn, type: "IPv4", subnet: `10.${subnetBase + j}.0.0/16` });
    network.dataPaths.push([upf, { snssai, dnn }]);
  }
  if (cnt > 0) {
    subscriberNSSAI.push({ snssai, dnns });
  }
  return subscriberNSSAI;
}

const args = Yargs()
  .option("dn-in-cloud", YargsIntRange({
    desc: "Data Network quantity in cloud",
    default: 1,
    max: 9,
  }))
  .option("edges", YargsIntRange({
    desc: "edge network quantity",
    default: 2,
    max: 9,
  }))
  .option("dn-per-edge", YargsIntRange({
    desc: "Data Network quantity per edge",
    default: 1,
    min: 0,
    max: 9,
  }))
  .option("sub-per-edge", YargsIntRange({
    desc: "subscriber quantity per edge",
    default: 2,
    max: 99,
  }))
  .parseSync();

const { dnInCloud, edges, dnPerEdge, subPerEdge } = args;

const cloudSubscriberNSSAI = defineDnns("01", "cloud", 10, "upf0", dnInCloud);

for (let i = 1; i <= edges; ++i) {
  const edgeSubscriberNSSAI = defineDnns(`8${i}`, `edge${i}`, 100 + 10 * i, `upf${i}`, dnPerEdge);
  network.subscribers.push({
    supi: `00101700555${i}000`,
    count: subPerEdge,
    subscribedNSSAI: [
      ...cloudSubscriberNSSAI,
      ...edgeSubscriberNSSAI,
    ],
    gnbs: [`gnb${i}`],
  });
  network.gnbs.push({ name: `gnb${i}` });
  network.upfs.push({ name: `upf${i}` });
  network.dataPaths.push(
    [`upf${i}`, "upf0"],
    [`gnb${i}`, `upf${i}`],
  );
}

await file_io.write("-.json", network);
