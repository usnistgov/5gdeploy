import { YargsGroup, type YargsInfer, YargsIntRange } from "../util/mod.js";

/** Yargs options definition for free5GC. */
export const f5Options = YargsGroup("free5GC options:", {
  "gtp5g-dbg": YargsIntRange({
    default: 1,
    desc: "gtp5g log level (higher number is more verbose)",
    min: 0,
    max: 4,
  }),
  "gtp5g-qos": {
    default: false,
    desc: "toggle gtp5g QoS feature",
    type: "boolean",
  },
  "gtp5g-seq": {
    default: true,
    desc: "toggle gtp5g GTP-U sequence number feature",
    type: "boolean",
  },
  "free5gc-tag": {
    defaultDescription: "gather from free5gc-compose/docker-compose.yaml",
    desc: "free5GC Docker image tag",
    type: "string",
  },
});

export type F5Opts = YargsInfer<typeof f5Options>;
