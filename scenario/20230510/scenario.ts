import type { N } from "../../types/mod.js";
import { file_io, Yargs, YargsIntRange } from "../../util/mod.js";

const args = Yargs()
  .option("edges", YargsIntRange({
    desc: "edge network quantity",
    default: 2,
    max: 9,
  }))
  .option("sub-per-edge", YargsIntRange({
    desc: "subscriber quantity per edge",
    default: 2,
    max: 99,
  }))
  .parseSync();

const network: N.Network = {
  plmn: "001-01",
  gnbIdLength: 24,
  tac: "000005",
  subscribers: [],
  gnbs: [],
  upfs: [
    { name: "upf0" },
  ],
  dataNetworks: [
    { snssai: "01", dnn: "cloud", type: "IPv4", subnet: "10.1.0.0/16" },
  ],
  dataPaths: [
    ["upf0", { snssai: "01", dnn: "cloud" }],
  ],
};

const { edges, subPerEdge } = args;

for (let i = 1; i <= edges; ++i) {
  const snssai: N.SNSSAI = `8${i}`;
  const dnn = `edge${i}`;
  network.subscribers.push({
    supi: `00101700555${i}000`,
    count: subPerEdge,
    subscribedNSSAI: [
      { snssai: "01", dnns: ["cloud"] },
      { snssai, dnns: [dnn] },
    ],
    gnbs: [`gnb${i}`],
  });
  network.gnbs.push({ name: `gnb${i}` });
  network.upfs.push({ name: `upf${i}` });
  network.dataNetworks.push({ snssai, dnn, type: "IPv4", subnet: `10.${128 + i}.0.0/16` });
  network.dataPaths.push(
    [`upf${i}`, { snssai, dnn }],
    [`upf${i}`, "upf0"],
    [`gnb${i}`, `upf${i}`],
  );
}

await file_io.write("-.json", network);
