import type { ArrayValues, Simplify } from "type-fest";

import type { N } from "../../types/mod.js";
import { type YargsInfer, YargsIntRange, type YargsOptions } from "../../util/mod.js";
import * as ran from "./ran.js";

export const cliOptions = {
  gnbs: YargsIntRange({
    desc: "gNB quantity",
    default: 1,
    max: 9,
  }),
  phones: YargsIntRange({
    desc: "phone quantity",
    default: 4,
    min: 0,
    max: 1000,
  }),
  vehicles: YargsIntRange({
    desc: "vehicle quantity",
    default: 4,
    min: 0,
    max: 1000,
  }),
} as const satisfies YargsOptions;

export type CLIOptions = YargsInfer<typeof cliOptions>;

const dnDef = [
  { dnn: "internet", subnet: "10.1.0.0/16" },
  { dnn: "vcam", subnet: "10.140.0.0/16" },
  { dnn: "vctl", subnet: "10.141.0.0/16" },
] as const satisfies ReadonlyArray<Pick<N.DataNetwork, "dnn" | "subnet">>;

export type ScenarioOptions = Simplify<
Record<`${ArrayValues<typeof dnDef>["dnn"]}SNSSAI`, N.SNSSAI> &
Record<`${ArrayValues<typeof dnDef>["dnn"]}UPF`, string>
>;

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
    upfs: upfs.map((name) => ({ name })),
    dataNetworks: dnDef.map(({ dnn, subnet }) => ({
      snssai: s[`${dnn}SNSSAI`],
      dnn,
      type: "IPv4",
      subnet,
    })),
    dataPaths: dnDef.map(({ dnn }) => [
      s[`${dnn}UPF`],
      { snssai: s[`${dnn}SNSSAI`], dnn },
    ]),
  };

  for (let i = 0; i < c.gnbs; ++i) {
    const name = `gnb${i}`;
    network.gnbs.push({ name });
    network.dataPaths.push(...upfs.map((upf): N.DataPathLink => [name, upf]));
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
