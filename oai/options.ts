import path from "node:path";

import { YargsGroup, type YargsInfer } from "../util/mod.js";
import * as oai_common from "./common.js";

/** Yargs options definition for OAI. */
export const oaiOptions = YargsGroup("OAI options:", {
  "oai-cn5g-tag": {
    defaultDescription: "extract from oai-cn5g-fed repository checkout",
    desc: "OAI-CN5G Docker image tag",
    type: "string",
  },
  "oai-cn5g-nrf": {
    default: true,
    desc: "enable NRF in OAI-CN5G",
    type: "boolean",
  },
  "oai-cn5g-pcf": {
    default: false,
    desc: "enable PCF in OAI-CN5G",
    type: "boolean",
  },
  "oai-cn5g-nwdaf": {
    default: false,
    desc: "enable NWDAF in OAI-CN5G",
    type: "boolean",
  },
  "oai-upf-workers": {
    default: 2,
    desc: "number of worker threads in OAI-CN5G-UPF or OAI-CN5G-UPF-VPP",
    type: "number",
  },
  "oai-upf-bpf": {
    default: false,
    desc: "enable BPF datapath in OAI-CN5G-UPF",
    type: "boolean",
  },
  "oai-ran-tag": {
    defaultDescription: "extract from oai-cn5g-fed repository checkout",
    desc: "OpenAirInterface5G Docker image tag",
    type: "string",
  },
  "oai-gnb-conf": {
    default: path.join(oai_common.composePath, "ran-conf/gnb.conf"),
    desc: "OpenAirInterface5G gNB config file",
    normalize: true,
    type: "string",
  },
  "oai-gnb-usrp": {
    choices: ["b2xx"],
    desc: "use USRP hardware in OpenAirInterface5G gNB",
    type: "string",
  },
  "oai-ue-conf": {
    default: path.join(oai_common.composePath, "ran-conf/nr-ue.conf"),
    desc: "OpenAirInterface5G UE config file",
    normalize: true,
    type: "string",
  },
});
export type OAIOpts = YargsInfer<typeof oaiOptions>;
