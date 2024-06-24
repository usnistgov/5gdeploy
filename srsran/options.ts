import type { YargsInfer, YargsOptions } from "../util/mod.js";

/** Yargs options definition for srsRAN. */
export const srsOptions = {
  "srs-gnb-sdr": {
    desc: "srsGNB SDR config file",
    group: "srs",
    normalize: true,
    type: "string",
  },
} as const satisfies YargsOptions;
export type SRSOpts = YargsInfer<typeof srsOptions>;
