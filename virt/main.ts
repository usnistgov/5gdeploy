import path from "node:path";

import * as compose from "../compose/mod.js";
import { assert, codebaseRoot, Yargs } from "../util/mod.js";
import { VirtComposeContext, type VMNetwork, type VMOptions } from "./context.js";

const args = Yargs()
  .option("vm", {
    array: true,
    coerce(lines: readonly string[]): Array<VMOptions & { place: compose.PlaceRule }> {
      return Array.from(lines, (line) => {
        const tokens = line.split("|");
        assert(tokens.length === 3, `bad --vm ${line}`);
        const name = tokens[0]!.trim();
        const place = compose.parsePlaceRule(`vm_${name}@${tokens[1]!.trim()}`);
        assert(place.cpuset && place.cpuset.cores.length >= 2, `VM ${name} must have cpuset with at least 2 cores`);
        const networks = Array.from(tokens[2]!.split(","), (line1): VMNetwork => {
          const m = /^(\w+)@([^@+]+)$/i.exec(line1.trim());
          assert(m, `bad --vm.network ${line1}`);
          return [m[1]!.toLowerCase(), m[2]!];
        });
        assert(networks.some(([net]) => net === "vmctrl"), `VM ${name} does not have vmctrl network`);
        return {
          name,
          cores: place.cpuset.cores,
          networks,
          place,
        };
      });
    },
    demandOption: true,
    desc: "virtual machine definition",
    nargs: 1,
    type: "string",
  })
  .option("ctrlif", {
    demandOption: true,
    type: "string",
  })
  .option("out", {
    default: path.join(codebaseRoot, "../compose/virt"),
    desc: "Compose output directory",
    type: "string",
  })
  .option(compose.ipAllocOptions)
  .option("ssh-uri", compose.placeOptions["ssh-uri"])
  .parseSync();

const ctx = new VirtComposeContext(args.out, new compose.IPAlloc(args));
ctx.createCtrlif(args.ctrlif);

const placeRules: compose.PlaceRule[] = [];
for (const vm of args.vm) {
  ctx.defineVM(vm);
  placeRules.push(vm.place);
}

compose.place(ctx.c, { ...args, place: placeRules });
await ctx.finalSave();
