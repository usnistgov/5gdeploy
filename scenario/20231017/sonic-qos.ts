import type { Operation } from "fast-json-patch";
import * as shlex from "shlex";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const args = await yargs(hideBin(process.argv))
  .strict()
  .option("op", {
    choices: ["add", "remove", "drop"],
    default: "add",
    desc: "JSON patch operation",
    type: "string",
  })
  .option("prefix", {
    default: "5gdeploy-20231017-",
    desc: "table key prefix",
    type: "string",
  })
  .option("format", {
    choices: ["patch", "pretty", "shell"],
    default: "patch",
    desc: "output format",
    type: "string",
  })
  .option("port-gnb", {
    demandOption: true,
    desc: "gNB switchport",
    string: true,
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
  .option("dl-gnb", {
    demandOption: true,
    desc: "downlink rate limit per gNB (Mbps)",
    type: "number",
  })
  .option("dl-sched", {
    choices: ["STRICT", "WRR", "DWRR"] as const,
    default: "STRICT",
    desc: "downlink scheduler type",
    type: "string",
  })
  .option("dl-w1", {
    default: 20,
    desc: "downlink UPF1 traffic weight (1..100)",
    type: "string",
  })
  .option("dl-w4", {
    default: 80,
    desc: "downlink UPF4 traffic weight (1..100)",
    type: "string",
  })
  .parseAsync();

const tables = new Set<string>();
const patch: Operation[] = [];
function setConfig(path: string, value: unknown): void {
  const table = path.split("/")[1]!;
  tables.add(table);
  switch (args.op) {
    case "add": {
      patch.push({ op: "add", path, value });
      break;
    }
    case "remove":
    case "drop": {
      patch.push({ op: "remove", path });
      break;
    }
  }
}

setConfig(`/DOT1P_TO_TC_MAP/${args.prefix}upf1`, { 0: "1" });
setConfig(`/PORT_QOS_MAP/${args.portUpf1}`, { dot1p_to_tc_map: `${args.prefix}upf1` });
setConfig(`/DOT1P_TO_TC_MAP/${args.prefix}upf4`, { 0: "0" });
setConfig(`/PORT_QOS_MAP/${args.portUpf4}`, { dot1p_to_tc_map: `${args.prefix}upf4` });

for (const [i, gnbPort] of args.portGnb.entries()) {
  const bytesPerSec = Math.ceil(args.dlGnb * 1e6 / 8);
  setConfig(`/SCHEDULER/${args.prefix}gnb${i}`, {
    type: "STRICT",
    meter_type: "bytes",
    pir: `${bytesPerSec}`,
    pbs: "8192",
  });
  setConfig(`/PORT_QOS_MAP/${gnbPort}`, {
    scheduler: `${args.prefix}gnb${i}`,
  });
  setConfig(`/SCHEDULER/${args.prefix}gnb${i}upf1`, {
    type: args.dlSched,
    weight: args.dlSched === "STRICT" ? undefined : `${args.dlW1}`,
  });
  setConfig(`/QUEUE/${gnbPort}|1`, {
    scheduler: `${args.prefix}gnb${i}upf1`,
  });
  setConfig(`/SCHEDULER/${args.prefix}gnb${i}upf4`, {
    type: args.dlSched,
    weight: args.dlSched === "STRICT" ? undefined : `${args.dlW4}`,
  });
  setConfig(`/QUEUE/${gnbPort}|0`, {
    scheduler: `${args.prefix}gnb${i}upf4`,
  });
}

for (const table of tables) {
  switch (args.op) {
    case "add": {
      patch.unshift({ op: "add", path: `/${table}`, value: {} });
      break;
    }
    case "drop": {
      patch.push({ op: "remove", path: `/${table}` });
      break;
    }
  }
}

switch (args.format) {
  case "patch": {
    process.stdout.write(`${JSON.stringify(patch)}\n`);
    break;
  }
  case "pretty": {
    process.stdout.write(JSON.stringify(patch, undefined, 2));
    break;
  }
  case "shell": {
    process.stdout.write(`echo ${shlex.quote(JSON.stringify(patch))} | sudo config apply /dev/stdin\n`);
    break;
  }
}
