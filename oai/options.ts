import path from "node:path";

import type { YargsInfer, YargsOptions } from "../util/mod.js";
import * as oai_conf from "./conf.js";

/** Yargs options definition for OAI. */
export const oaiOptions = {
  "oai-cn5g-tag": {
    defaultDescription: "gather from docker-compose-slicing-basic-nrf.yaml",
    desc: "OAI-CN5G Docker image tag",
    group: "oai",
    type: "string",
  },
  "oai-cn5g-nrf": {
    default: true,
    desc: "enable NRF in OAI-CN5G",
    group: "oai",
    type: "boolean",
  },
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
  "oai-ran-tag": {
    defaultDescription: "gather from docker-compose-slicing-ransim.yaml",
    desc: "OpenAirInterface5G Docker image tag",
    group: "oai",
    type: "string",
  },
  "oai-gnb-conf": {
    default: path.join(oai_conf.composePath, "ran-conf/gnb.conf"),
    desc: "OpenAirInterface5G gNB config file",
    group: "oai",
    normalize: true,
    type: "string",
  },
  "oai-gnb-usrp": {
    choices: ["b2xx"],
    desc: "use USRP hardware in OpenAirInterface5G gNB",
    group: "oai",
    type: "string",
  },
  "oai-ue-conf": {
    default: path.join(oai_conf.composePath, "ran-conf/nr-ue.conf"),
    desc: "OpenAirInterface5G UE config file",
    group: "oai",
    normalize: true,
    type: "string",
  },
} as const satisfies YargsOptions;
export type OAIOpts = YargsInfer<typeof oaiOptions>;
