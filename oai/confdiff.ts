import { default as fastJsonPatch } from "fast-json-patch"; // eslint-disable-line import/no-named-default
import type { CommandModule } from "yargs";

import { file_io, Yargs } from "../util/mod.js";
import { loadLibconf } from "./conf.js";

const command: CommandModule<{}, {
  out: string;
  a: string;
  b: string;
}> = {
  command: "$0 <a> <b>",
  describe: "compare two libconf files",
  builder(yargs) {
    return yargs
      .option("out", { default: "-.json", desc: "JSON patch output", type: "string" })
      .positional("a", { demandOption: true, normalize: true, type: "string" })
      .positional("b", { demandOption: true, normalize: true, type: "string" });
  },
  async handler({ a, b, out }) {
    const fa = await loadLibconf(a);
    const fb = await loadLibconf(b);
    const patch = fastJsonPatch.compare(fa, fb, true);
    await file_io.write(out, patch);
  },
};

await Yargs()
  .command(command)
  .parseAsync();
