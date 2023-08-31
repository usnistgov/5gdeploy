import type * as N from "@usnistgov/5gdeploy/types/netdef.ts";
import assert from "minimalistic-assert";

const nGNBs = 2;
const nPhones = 50;
const nVehicles = 10;

const network: N.Network = {
  plmn: "001-01",
  gnbIdLength: 24,
  tac: "000005",
  subscribers: [],
  gnbs: [],
  amfs: [
    {
      name: "amf",
      amfi: [1, 1, 0],
    },
  ],
  smfs: [
    {
      name: "smf",
    },
  ],
  upfs: [
    { name: "upf1" },
    { name: "upf140" },
    { name: "upf141" },
  ],
  dataNetworks: [
    { snssai: "01", dnn: "internet", type: "IPv4", subnet: "10.1.0.0/16" },
    { snssai: "8C", dnn: "vcam", type: "IPv4", subnet: "10.140.0.0/16" },
    { snssai: "8D", dnn: "vctl", type: "IPv4", subnet: "10.141.0.0/16" },
  ],
  dataPaths: {
    links: [
      ["upf1", { snssai: "01", dnn: "internet" }],
      ["upf140", { snssai: "8C", dnn: "vcam" }],
      ["upf141", { snssai: "8D", dnn: "vctl" }],
    ],
  },
};

assert(nGNBs < 10);
for (let i = 0; i < nGNBs; ++i) {
  const name = `gnb${i}`;
  network.gnbs.push({ name, nci: `00000${i}001` });
  network.dataPaths.links.push(
    [name, "upf1"],
    [name, "upf140"],
    [name, "upf141"],
  );
}

for (const [firstSUPI, count, subscribedNSSAI] of [
  ["001017005551000", nPhones, [{ snssai: "01", dnns: ["internet"] }]],
  ["001017005554000", nVehicles, [{ snssai: "8C", dnns: ["vcam"] }, { snssai: "8D", dnns: ["vctl"] }]],
] as Array<[string, number, N.SubscriberSNSSAI[]]>) {
  assert(count % nGNBs === 0);
  const supi = BigInt(firstSUPI);
  for (let i = 0; i < nGNBs; ++i) {
    network.subscribers.push({
      supi: supi.toString().padStart(15, "0"),
      count: count / nGNBs,
      subscribedNSSAI,
      gnbs: [`gnb${i}`],
    });
  }
}

process.stdout.write(`${JSON.stringify(network)}\n`);
