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
        return {
          name,
          place,
          nCores: place.cpuset?.nAvail ?? 4,
          networks: Array.from(tokens[2]!.split(","), (line1): VMNetwork => {
            const m = /^(\w+)@((?:[\da-f]{2}:){5}[\da-f]{2})$/.exec(line1.trim());
            assert(m, `bad --vm.network ${line1}`);
            return [m[1]!, m[2]!];
          }),
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
  .option(compose.placeOptions)
  .parseSync();
args.place.splice(0, Infinity);

const ctx = new VirtComposeContext(args.out, new compose.IPAlloc(args));
ctx.createCtrlif(args.ctrlif);

for (const vm of args.vm) {
  ctx.defineVM(vm);
  args.place.push(vm.place);
}

compose.place(ctx.c, args);
await ctx.finalSave();
