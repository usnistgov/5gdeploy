import type * as N from "@usnistgov/5gdeploy/types/netdef.ts";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import * as ran from "../common/ran.js";

const args = await yargs(hideBin(process.argv))
  .strict()
  .option("gnbs", ran.option("gNB", 2, 9))
  .option("phones", ran.option("phone", 48, 1000))
  .option("vehicles", ran.option("vehicle", 12, 1000))
  .parseAsync();

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
    { snssai: "01000000", dnn: "internet", type: "IPv4", subnet: "10.1.0.0/16" },
    { snssai: "8C000000", dnn: "vcam", type: "IPv4", subnet: "10.140.0.0/16" },
    { snssai: "8D000000", dnn: "vctl", type: "IPv4", subnet: "10.141.0.0/16" },
  ],
  dataPaths: {
    links: [
      ["upf1", { snssai: "01000000", dnn: "internet" }],
      ["upf140", { snssai: "8C000000", dnn: "vcam" }],
      ["upf141", { snssai: "8D000000", dnn: "vctl" }],
    ],
  },
};

for (let i = 0; i < args.gnbs; ++i) {
  const name = `gnb${i}`;
  network.gnbs.push({ name, nci: `00000${i}001` });
  network.dataPaths.links.push(
    [name, "upf1"],
    [name, "upf140"],
    [name, "upf141"],
  );
}

ran.addUEsPerGNB(network, "001017005551000", args.phones, [
  { snssai: "01000000", dnns: ["internet"] },
]);
ran.addUEsPerGNB(network, "001017005554000", args.vehicles, [
  { snssai: "8C000000", dnns: ["vcam"] },
  { snssai: "8D000000", dnns: ["vctl"] },
]);
process.stdout.write(`${JSON.stringify(network)}\n`);
