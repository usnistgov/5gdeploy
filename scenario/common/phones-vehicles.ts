import { sortBy } from "sort-by-typescript";
import type { ArrayValues, Simplify } from "type-fest";

import type * as netdef from "../../netdef/mod.js";
import type { N } from "../../types/mod.js";
import { assert, type YargsInfer, YargsIntRange, type YargsOpt, type YargsOptions } from "../../util/mod.js";
import * as ran from "./ran.js";

function ambrOption(kind: string) {
  return {
    array: false,
    coerce(line: string) {
      const m = /^([\d.]+),([\d.]+)$/.exec(line);
      assert(m, `bad AMBR option ${line}`);
      return {
        dlAmbr: Number.parseFloat(m[1]!),
        ulAmbr: Number.parseFloat(m[2]!),
      } satisfies Partial<netdef.DataNetwork>;
    },
    desc: `AMBR of ${kind} - dlAmbr,ulAmbr (Mbps)`,
    type: "string",
  } as const satisfies YargsOpt;
}

function qosOption(dnn: string) {
  return {
    array: false,
    coerce(line: string) {
      const m = /^(\d+),(\d+),(\d+),([\d.]+),([\d.]+)$/.exec(line);
      assert(m, `bad QoS option ${line}`);
      return {
        fiveQi: Number.parseInt(m[1]!, 10),
        fiveQiPriorityLevel: Number.parseInt(m[2]!, 10),
        arpLevel: Number.parseInt(m[3]!, 10),
        dlAmbr: Number.parseFloat(m[4]!),
        ulAmbr: Number.parseFloat(m[5]!),
      } satisfies Partial<netdef.DataNetwork>;
    },
    desc: `QoS of ${dnn} Data Network - 5qi,5qiPriorityLevel,dlAmbr,ulAmbr (Mbps)`,
    type: "string",
  } as const satisfies YargsOpt;
}

export const cliOptions = {
  gnbs: YargsIntRange({
    default: 1,
    desc: "gNB quantity",
    max: 9,
  }),
  "gnb-visibility": {
    choices: ["single", "full"],
    default: "single",
    desc: "gNB visibility from UEs",
    type: "string",
  },
  phones: YargsIntRange({
    default: 4,
    desc: "phone quantity",
    min: 0,
    max: 1000,
  }),
  "phone-ambr": ambrOption("phones"),
  vehicles: YargsIntRange({
    default: 4,
    desc: "vehicle quantity",
    min: 0,
    max: 1000,
  }),
  "vehicle-ambr": ambrOption("vehicles"),
  "qos-internet": qosOption("internet"),
  "qos-vcam": qosOption("vcam"),
  "qos-vctl": qosOption("vctl"),
} as const satisfies YargsOptions;

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
export function buildNetwork(opts: YargsInfer<typeof cliOptions>, s: ScenarioOptions): N.Network {
  const upfs = Array.from(new Set(dnDef.map(({ dnn }) => s[`${dnn}UPF`]))).toSorted(sortBy());

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
      ...opts[`qos-${dnn}`],
    })),
    dataPaths: dnDef.map(({ dnn }) => [
      s[`${dnn}UPF`],
      { snssai: s[`${dnn}SNSSAI`], dnn },
    ]),
  };

  for (let i = 0; i < opts.gnbs; ++i) {
    const name = `gnb${i}`;
    network.gnbs.push({ name });
    network.dataPaths.push(...upfs.map((upf): N.DataPathLink => [name, upf]));
  }

  let addUEs = ran.addUEsPerGnb;
  if (opts["gnb-visibility"] === "full") {
    addUEs = ran.addUEsFullConnect;
  }
  addUEs(network, "001017005551000", opts.phones, {
    subscribedNSSAI: [
      { snssai: s.internetSNSSAI, dnns: ["internet"] },
    ],
    ...opts["phone-ambr"],
  });
  addUEs(network, "001017005554000", opts.vehicles, {
    subscribedNSSAI: s.vcamSNSSAI === s.vctlSNSSAI ? [
      { snssai: s.vcamSNSSAI, dnns: ["vcam", "vctl"] },
    ] : [
      { snssai: s.vcamSNSSAI, dnns: ["vcam"] },
      { snssai: s.vctlSNSSAI, dnns: ["vctl"] },
    ],
    ...opts["vehicle-ambr"],
  });

  return network;
}
