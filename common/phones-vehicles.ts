import type * as N from "@usnistgov/5gdeploy/types/netdef.ts";
import type { InferredOptionTypes, Options as YargsOptions } from "yargs";

import * as ran from "./ran.js";

export const cliOptions = {
  gnbs: ran.option("gNB", 1, 9),
  phones: ran.option("phone", 6, 1000, 0),
  vehicles: ran.option("vehicle", 2, 1000, 0),
} as const satisfies Record<string, YargsOptions>;

export type CLIOptions = InferredOptionTypes<typeof cliOptions>;

export interface ScenarioOptions {
  internetSNSSAI: N.SNSSAI;
  internetUPF: string;
  vcamSNSSAI: N.SNSSAI;
  vcamUPF: string;
  vctlSNSSAI: N.SNSSAI;
  vctlUPF: string;
}

const dnDef = [
  { dnn: "internet", subnet: "10.1.0.0/16" },
  { dnn: "vcam", subnet: "10.140.0.0/16" },
  { dnn: "vctl", subnet: "10.141.0.0/16" },
] as const satisfies ReadonlyArray<Pick<N.DataNetwork, "dnn" | "subnet">>;

/** Build a network with phones and vehicles. */
export function buildNetwork(c: CLIOptions, s: ScenarioOptions): N.Network {
  const upfs = Array.from(new Set(dnDef.map(({ dnn }) => s[`${dnn}UPF`])))
    .sort((a, b) => a.localeCompare(b));

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
    upfs: upfs.map((name) => ({ name })),
    dataNetworks: dnDef.map(({ dnn, subnet }) => ({
      snssai: s[`${dnn}SNSSAI`],
      dnn,
      type: "IPv4",
      subnet,
    })),
    dataPaths: {
      links: dnDef.map(({ dnn }) => [
        s[`${dnn}UPF`],
        { snssai: s[`${dnn}SNSSAI`], dnn },
      ]),
    },
  };

  for (let i = 0; i < c.gnbs; ++i) {
    const name = `gnb${i}`;
    network.gnbs.push({ name, nci: `00000${i}001` });
    network.dataPaths.links.push(...upfs.map((upf): N.DataPathLink => [name, upf]));
  }

  ran.addUEsPerGNB(network, "001017005551000", c.phones, [
    { snssai: s.internetSNSSAI, dnns: ["internet"] },
  ]);
  ran.addUEsPerGNB(network, "001017005554000", c.vehicles,
    s.vcamSNSSAI === s.vctlSNSSAI ? [
      { snssai: s.vcamSNSSAI, dnns: ["vcam", "vctl"] },
    ] : [
      { snssai: s.vcamSNSSAI, dnns: ["vcam"] },
      { snssai: s.vctlSNSSAI, dnns: ["vctl"] },
    ],
  );

  return network;
}
