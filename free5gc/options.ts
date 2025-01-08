import { type YargsInfer, YargsIntRange, type YargsOptions } from "../util/mod.js";

/** Yargs options definition for free5GC. */
export const f5Options = {
  "gtp5g-dbg": YargsIntRange({
    default: 1,
    desc: "gtp5g log level",
    group: "free5gc",
    min: 0,
    max: 4,
  }),
  "gtp5g-qos": {
    default: false,
    desc: "toggle gtp5g QoS feature",
    group: "free5gc",
    type: "boolean",
  },
  "gtp5g-seq": {
    default: true,
    desc: "toggle gtp5g GTP-U sequence number feature",
    group: "free5gc",
    type: "boolean",
  },
  "free5gc-tag": {
    defaultDescription: "gather from free5gc-compose/docker-compose.yaml",
    desc: "free5GC Docker image tag",
    group: "free5gc",
    type: "string",
  },
} as const satisfies YargsOptions;

export type F5Opts = YargsInfer<typeof f5Options>;
