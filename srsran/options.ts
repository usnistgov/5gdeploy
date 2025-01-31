import { YargsGroup, type YargsInfer } from "../util/mod.js";

/** Yargs options definition for srsRAN. */
export const srsOptions = YargsGroup("srsRAN options:", {
  "srs-gnb-sdr": {
    desc: "srsGNB SDR config file",
    normalize: true,
    type: "string",
  },
});
export type SRSOpts = YargsInfer<typeof srsOptions>;
