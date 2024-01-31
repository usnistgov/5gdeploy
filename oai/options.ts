import { type InferredOptionTypes, type Options as YargsOptions } from "yargs";

export const oaiOptions = {
  "oai-upf-workers": {
    default: 2,
    desc: "number of worker threads in OAI-CN5G-UPF or OAI-UPF-VPP",
    group: "oai",
    type: "number",
  },
  "oai-upf-bpf": {
    default: false,
    desc: "enable BPF datapath in OAI-CN5G-UPF",
    group: "oai",
    type: "boolean",
  },
} as const satisfies Record<string, YargsOptions>;
export type OAIOpts = InferredOptionTypes<typeof oaiOptions>;
