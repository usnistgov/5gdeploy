import { Minimatch } from "minimatch";
import { Netmask } from "netmask";

import * as compose from "../compose/mod.js";
import { cmdOptions, cmdOutput, Yargs, YargsIntRange } from "../util/mod.js";
import { ctxOptions, gatherPduSessions, loadCtx } from "./common.js";

const args = Yargs()
  .option(ctxOptions)
  .option(cmdOptions)
  .option("dnn", {
    coerce(arg: string) {
      return new Minimatch(arg);
    },
    desc: "Data Network Name",
    type: "string",
  })
  .option("subnet-size", YargsIntRange({
    desc: "minimal scanned subnet size",
    default: 28,
    min: 16,
    max: 32,
  }))
  .parseSync();

const [c, netdef] = await loadCtx(args);

const scans = new Map<string, [target: Netmask, count: number]>();

for await (const { dn: { dnn, subnet }, pduIP } of gatherPduSessions(c, netdef)) {
  if (args.dnn && !args.dnn.match(dnn)) {
    continue;
  }
  const fullSubnet = new Netmask(subnet!);

  let [target, count] = scans.get(dnn) ?? [
    new Netmask(fullSubnet.base, args["subnet-size"]),
    0,
  ];
  while (!target.contains(pduIP) && target.bitmask > fullSubnet.bitmask) {
    target = new Netmask(target.base, target.bitmask - 1);
  }
  ++count;
  scans.set(dnn, [target, count]);
}

await cmdOutput(args, (function*() {
  for (const [dnn, [target, count]] of scans) {
    const dnService = c.services[`dn_${dnn}`]!;
    const dnIP = compose.annotate(dnService, "ip_n6")!;
    yield `msg Scanning ${target} in ${dnn}, expect ${count} hosts up`;
    yield `${compose.makeDockerH(dnService)} run --name nmap_${dnn} --rm --network container:${
      dnService.container_name} networkstatic/nmap -S ${dnIP} -n -sn ${target}`;
  }
})());
