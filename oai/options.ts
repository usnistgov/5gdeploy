import path from "node:path";

import type { YargsInfer, YargsOptions } from "../util/mod.js";
import * as oai_common from "./common.js";

/** Yargs options definition for OAI. */
export const oaiOptions = {
  "oai-cn5g-tag": {
    defaultDescription: "extract from oai-cn5g-fed repository checkout",
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
  "oai-cn5g-pcf": {
    default: false,
    desc: "enable PCF in OAI-CN5G",
    group: "oai",
    type: "boolean",
  },
  "oai-cn5g-nwdaf": {
    default: false,
    desc: "enable NWDAF in OAI-CN5G",
    group: "oai",
    type: "boolean",
  },
  "oai-upf-workers": {
    default: 2,
    desc: "number of worker threads in OAI-CN5G-UPF or OAI-CN5G-UPF-VPP",
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
    defaultDescription: "extract from oai-cn5g-fed repository checkout",
    desc: "OpenAirInterface5G Docker image tag",
    group: "oai",
    type: "string",
  },
  "oai-gnb-conf": {
    default: path.join(oai_common.composePath, "ran-conf/gnb.conf"),
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
    default: path.join(oai_common.composePath, "ran-conf/nr-ue.conf"),
    desc: "OpenAirInterface5G UE config file",
    group: "oai",
    normalize: true,
    type: "string",
  },
} as const satisfies YargsOptions;
export type OAIOpts = YargsInfer<typeof oaiOptions>;
