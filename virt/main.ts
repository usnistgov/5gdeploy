import os from "node:os";
import path from "node:path";

import * as compose from "../compose/mod.js";
import { assert, codebaseRoot, file_io, parseCpuset, splitVbar, Yargs } from "../util/mod.js";
import { VirtComposeContext, type VMNetwork, type VMOptions } from "./context.js";

const args = Yargs()
  .option("vm", {
    array: true,
    coerce(lines: readonly string[]): Array<VMOptions & { place: compose.PlaceRule }> {
      return Array.from(lines, (line) => {
        const tokens = splitVbar("--vm", line, 3, 3);
        const name = tokens[0];
        const place = compose.parsePlaceRule(`vm_${name}@${tokens[1]}`);
        const cores = parseCpuset(place.cpuset ?? "0");
        assert(cores.length >= 2, `VM ${name} must have cpuset with at least 2 cores`);
        const networks = Array.from(tokens[2].split(","), (line1): VMNetwork => {
          const tokens = line1.split("@");
          assert(tokens.length === 2, `bad --vm.network ${line1}`);
          return [tokens[0]!.toLowerCase(), tokens[1]!];
        });
        assert(networks.some(([net]) => net === "vmctrl"), `VM ${name} does not have vmctrl network`);
        return { name, cores, networks, place };
      });
    },
    demandOption: true,
    desc: "virtual machine definition",
    nargs: 1,
    type: "string",
  })
  .option("ctrlif", {
    demandOption: true,
    desc: "vmctrl netif on primary host",
    type: "string",
  })
  .option("out", {
    default: path.join(codebaseRoot, "../compose/virt"),
    desc: "Compose output directory",
    type: "string",
  })
  .option("volume-prefix0", {
    default: `${os.userInfo().username}_`,
    desc: "Docker volume name prefix for base image and per-VM images",
    type: "string",
  })
  .option("volume-prefix1", {
    default: "",
    desc: "Docker volume name prefix for per-VM images",
    type: "string",
  })
  .option(compose.cpufreqOptions)
  .option(compose.ipAllocOptions("172.25.160.0/20"))
  .option("ssh-uri", compose.placeOptions["ssh-uri"])
  .parseSync();

const ctx = new VirtComposeContext(args.out, new compose.IPAlloc(args));
ctx.volumePrefix = [args["volume-prefix0"], args["volume-prefix1"]];
ctx.authorizedKeys = await file_io.readText(path.join(os.homedir(), ".ssh/id_ed25519.pub"));

ctx.createCtrlif(args.ctrlif);

const placeRules: compose.PlaceRule[] = [];
for (const vm of args.vm) {
  ctx.defineVM(vm);
  placeRules.push(vm.place);
}

compose.makeCpufreqService(ctx, args, "virt_cpufreq");
compose.place(ctx.c, { ...args, place: placeRules });
ctx.createSriov();
await ctx.finalSave();
