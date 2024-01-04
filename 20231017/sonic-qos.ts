import type { Operation } from "fast-json-patch";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const args = await yargs(hideBin(process.argv))
  .strict()
  .option("port-gnb", {
    demandOption: true,
    desc: "gNB switchport",
    string: true,
    type: "array",
  })
  .option("dl-gnb", {
    demandOption: true,
    desc: "gNB downlink rate limit (Mbps)",
    number: true,
    type: "array",
  })
  .option("port-upf1", {
    demandOption: true,
    desc: "UPF1 switchport",
    type: "string",
  })
  .option("port-upf4", {
    demandOption: true,
    desc: "UPF4 switchport",
    type: "string",
  })
  .parseAsync();

const patch: Operation[] = [
  {
    op: "add",
    path: "/DOT1P_TO_TC_MAP/upf1",
    value: {
      0: "7",
    },
  },
  {
    op: "add",
    path: `/PORT_QOS_MAP/${args.portUpf1}`,
    value: {
      dot1p_to_tc_map: "upf1",
    },
  },
  {
    op: "add",
    path: "/DOT1P_TO_TC_MAP/upf4",
    value: {
      0: "0",
    },
  },
  {
    op: "add",
    path: `/PORT_QOS_MAP/${args.portUpf4}`,
    value: {
      dot1p_to_tc_map: "upf4",
    },
  },
];
for (const [i, gnbPort] of args.portGnb.entries()) {
  const dl = args.dlGnb[i % args.dlGnb.length]!;
  patch.push({
    op: "add",
    path: `/SCHEDULER/gnb${i}`,
    value: {
      meter_type: "bytes",
      pbs: "8192",
      pir: `${dl * 1e6 / 8}`,
      type: "STRICT",
    },
  }, {
    op: "add",
    path: `/PORT_QOS_MAP/${gnbPort}`,
    value: {
      scheduler: `gnb${i}`,
    },
  });
}

process.stdout.write(`${JSON.stringify(patch)}\n`);
