import { YargsGroup, type YargsInfer } from "../util/mod.js";

/** Yargs options definition for Open5GS. */
export const o5gOptions = YargsGroup("Open5GS options:", {
  "o5g-loglevel": {
    choices: ["fatal", "error", "warn", "info", "debug", "trace"],
    default: "info",
    desc: "log level",
  },
});
export type O5GOpts = YargsInfer<typeof o5gOptions>;
