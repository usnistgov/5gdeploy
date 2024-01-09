import type { Operation } from "fast-json-patch";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const args = await yargs(hideBin(process.argv))
  .strict()
  .option("reverse", {
    default: false,
    desc: "remove instead of add",
    type: "boolean",
  })
  .option("drop-tables", {
    default: false,
    desc: "drop tables (only relevant with --reverse)",
    type: "boolean",
  })
  .option("prefix", {
    default: "5gdeploy-20231017-",
    desc: "table key prefix",
    type: "string",
  })
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

const tables = new Set<string>();
const patch: Operation[] = [];
function setConfig(path: string, value: unknown): void {
  tables.add(path.split("/")[1]!);
  if (!args.reverse) {
    patch.push({ op: "add", path, value });
  } else if (!args.dropTables) {
    patch.push({ op: "remove", path });
  }
}

setConfig(`/DOT1P_TO_TC_MAP/${args.prefix}upf1`, { 0: "1" });
setConfig(`/PORT_QOS_MAP/${args.portUpf1}`, { dot1p_to_tc_map: `${args.prefix}upf1` });
setConfig(`/DOT1P_TO_TC_MAP/${args.prefix}upf4`, { 0: "0" });
setConfig(`/PORT_QOS_MAP/${args.portUpf4}`, { dot1p_to_tc_map: `${args.prefix}upf4` });

for (const [i, gnbPort] of args.portGnb.entries()) {
  const mbitsPerSec = args.dlGnb[i % args.dlGnb.length]!;
  const bytesPerSec = Math.ceil(mbitsPerSec * 1e6 / 8);
  setConfig(`/SCHEDULER/${args.prefix}gnb${i}`, {
    type: "STRICT",
    meter_type: "bytes",
    pir: `${bytesPerSec}`,
    pbs: "8192",
  });
  setConfig(`/PORT_QOS_MAP/${gnbPort}`, {
    scheduler: `${args.prefix}gnb${i}`,
  });
}

for (const table of tables) {
  if (!args.reverse) {
    patch.unshift({ op: "add", path: `/${table}`, value: {} });
  } else if (args.dropTables) {
    patch.push({ op: "remove", path: `/${table}` });
  }
}

process.stdout.write(`${JSON.stringify(patch)}\n`);
