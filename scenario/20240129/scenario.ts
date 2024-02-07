import assert from "minimalistic-assert";

import type { N } from "../../types/mod.ts";
import { decPad, hexPad, Yargs } from "../../util/mod.js";
import * as ran from "../common/ran.js";

const ALPHABET = "abcdefgh";

const args = Yargs()
  .option("dn", ran.option("Data Network", 1, 99))
  .option("upf", ran.option("UPF", 1, ALPHABET.length))
  .option("gnb", ran.option("gNB", 1, 9))
  .option("same-snssai", {
    default: false,
    desc: "make all Data Networks have the same S-NSSAI",
    type: "boolean",
  })
  .option("dn-per-ue", {
    default: 15,
    desc: "maximum Data Networks per UE",
    type: "number",
  })
  .parseSync();

const network: N.Network = {
  plmn: "001-01",
  gnbIdLength: 24,
  tac: "000005",
  subscribers: [],
  gnbs: [],
  upfs: [],
  dataNetworks: [],
  dataPaths: {
    links: [],
  },
};

const { dn: dnCount, upf: upfCount, gnb: gnbCount, sameSnssai, dnPerUe } = args;

for (let upfIndex = 0; upfIndex < upfCount; ++upfIndex) {
  const upfName = `upf_${ALPHABET[upfIndex]}`;
  network.upfs.push({ name: upfName });

  const dnInUpf = Math.min(Math.ceil(dnCount / upfCount), dnCount - network.dataNetworks.length);
  for (let i = 0; i < dnInUpf; ++i) {
    const dnIndex = network.dataNetworks.length;
    const dnn = `${ALPHABET[upfIndex]}${decPad(dnIndex, 2)}`;
    const snssai: N.SNSSAI = sameSnssai ? "01000000" : `${hexPad(0x80 + dnIndex, 2)}000000`;

    network.dataNetworks.push({
      dnn,
      snssai,
      subnet: `10.${128 + dnIndex}.0.0/16`,
      type: "IPv4",
    });

    network.dataPaths.links.push([{ dnn, snssai }, upfName]);
  }
}
assert(network.dataNetworks.length === dnCount);

let supi = 7005551000n;
for (let gnbIndex = 0; gnbIndex < gnbCount; ++gnbIndex) {
  const gnbName = `gnb${gnbIndex}`;
  network.gnbs.push({ name: gnbName });
  for (const { name: upfName } of network.upfs) {
    network.dataPaths.links.push([gnbName, upfName]);
  }

  for (let dnFirst = 0; dnFirst < dnCount; dnFirst += dnPerUe) {
    const dnLast = Math.min(dnFirst + dnPerUe, dnCount);
    const subscribedNSSAI: N.SubscriberSNSSAI[] = [];
    for (let i = dnFirst; i < dnLast; ++i) {
      const dn = network.dataNetworks[i]!;
      if (subscribedNSSAI.at(-1)?.snssai === dn.snssai) {
        subscribedNSSAI.at(-1)!.dnns.push(dn.dnn);
      } else {
        subscribedNSSAI.push({ snssai: dn.snssai, dnns: [dn.dnn] });
      }
    }

    network.subscribers.push({
      supi: `00101${supi++}`,
      subscribedNSSAI,
      gnbs: [gnbName],
    });
  }
}

process.stdout.write(`${JSON.stringify(network)}\n`);
