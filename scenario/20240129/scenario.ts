import type { N } from "../../types/mod.ts";
import { decPad, hexPad, Yargs } from "../../util/mod.js";
import * as ran from "../common/ran.js";

const args = Yargs()
  .option("dn", ran.option("Data Network", 1, 99))
  .option("upf", ran.option("UPF", 1, 9))
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
  network.upfs.push({
    name: `upf${upfIndex}`,
  });
}

for (let dnIndex = 0; dnIndex < dnCount; ++dnIndex) {
  const dnn = `n${decPad(dnIndex, 2)}`;
  const snssai: N.SNSSAI = sameSnssai ? "01000000" : `${hexPad(0x80 + dnIndex, 2)}000000`;

  network.dataNetworks.push({
    dnn,
    snssai,
    subnet: `10.${128 + dnIndex}.0.0/16`,
    type: "IPv4",
  });

  const upfIndex = dnIndex % upfCount;
  network.dataPaths.links.push([
    { dnn, snssai },
    `upf${upfIndex}`,
  ]);
}

let supi = 7005551000n;
for (let gnbIndex = 0; gnbIndex < gnbCount; ++gnbIndex) {
  const gnbName = `gnb${gnbIndex}`;
  network.gnbs.push({ name: gnbName });

  for (let upfIndex = 0; upfIndex < upfCount; ++upfIndex) {
    network.dataPaths.links.push([gnbName, `upf${upfIndex}`]);
  }

  for (let dnFirst = 0; dnFirst < dnCount; dnFirst += dnPerUe) {
    const dnLast = Math.min(dnFirst + dnPerUe, dnCount);
    const subscribedNSSAI: N.SubscriberSNSSAI[] = [];
    if (sameSnssai) {
      subscribedNSSAI.push({
        snssai: "01000000",
        dnns: [],
      });
      for (let dnIndex = dnFirst; dnIndex < dnLast; ++dnIndex) {
        subscribedNSSAI[0]!.dnns.push(`n${decPad(dnIndex, 2)}`);
      }
    } else {
      for (let dnIndex = dnFirst; dnIndex < dnLast; ++dnIndex) {
        subscribedNSSAI.push({
          snssai: `${hexPad(0x80 + dnIndex, 2)}000000`,
          dnns: [`n${decPad(dnIndex, 2)}`],
        });
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
