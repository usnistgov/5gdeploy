import type * as N from "@usnistgov/5gdeploy/types/netdef.ts";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const args = await yargs(hideBin(process.argv))
  .strict()
  .option("gnbs", {
    desc: "gNodeB quantity (1..9)",
    default: 2,
    type: "number",
  })
  .option("phones", {
    desc: "phone quantity (1..1000, divisible by gnbs)",
    default: 48,
    type: "number",
  })
  .option("vehicles", {
    desc: "vehicle quantity (1..1000, divisible by gnbs)",
    default: 12,
    type: "number",
  })
  .check((args) => {
    if (args.gnbs < 1 || args.gnbs >= 10) {
      throw new Error("gnbs must be between 1 and 9");
    }
    for (const key of ["phones", "vehicles"] as const) {
      if (args[key] < 1 || args[key] > 1000 || args[key] % args.gnbs !== 0) {
        throw new Error(`${key} must be between 1 and 1000, and divisible by gnbs`);
      }
    }
    return true;
  })
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

for (const [firstSUPI, total, subscribedNSSAI] of [
  ["001017005551000", args.phones, [{ snssai: "01000000", dnns: ["internet"] }]],
  ["001017005554000", args.vehicles, [{ snssai: "8C000000", dnns: ["vcam"] }, { snssai: "8D000000", dnns: ["vctl"] }]],
] as Array<[string, number, N.SubscriberSNSSAI[]]>) {
  const count = total / args.gnbs;
  const supi = BigInt(firstSUPI);
  for (let i = 0; i < args.gnbs; ++i) {
    network.subscribers.push({
      supi: (supi + BigInt(i * count)).toString().padStart(15, "0"),
      count,
      subscribedNSSAI,
      gnbs: [`gnb${i}`],
    });
  }
}

process.stdout.write(`${JSON.stringify(network)}\n`);
