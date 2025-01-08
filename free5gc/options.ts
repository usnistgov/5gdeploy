import type { YargsInfer, YargsOptions } from "../util/mod.js";

/** Yargs options definition for free5GC. */
export const f5Options = {
  "free5gc-tag": {
    defaultDescription: "gather from free5gc-compose/docker-compose.yaml",
    desc: "free5GC Docker image tag",
    group: "free5gc",
    type: "string",
  },
} as const satisfies YargsOptions;

export type F5Opts = YargsInfer<typeof f5Options>;
