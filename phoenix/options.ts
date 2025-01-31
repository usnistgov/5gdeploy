import path from "node:path";

import { compose } from "../netdef-compose/mod.js";
import type { ComposeService } from "../types/mod.js";
import { assert, codebaseRoot, YargsGroup, type YargsInfer, YargsIntRange } from "../util/mod.js";

export const phoenixDockerImage = "5gdeploy.localhost/phoenix";
export const cfgdir = "/opt/phoenix/cfg/5gdeploy";

function tasksetOption(nf: string) {
  return {
    coerce(input: string): ["none" | "shhi" | "shlo", number] {
      const [mode = "", count = "1"] = input.split(":");
      assert(["none", "shhi", "shlo"].includes(mode), "bad --phoenix-*-taskset");
      if (mode === "none") {
        return [mode, 0];
      }
      const cnt = Number.parseInt(count, 10);
      assert([1, 2, 3, 4].includes(cnt), "bad --phoenix-*-taskset");
      return [mode, cnt] as any;
    },
    default: "shhi",
    desc: `configure CPU affinity for ${nf} worker threads`,
    type: "string",
  } as const;
}

export const phoenixOptions = YargsGroup("Open5GCore options:", {
  "phoenix-cfg": {
    default: path.resolve(codebaseRoot, "../phoenix-repo/phoenix-src/cfg"),
    desc: "path to phoenix-src/cfg",
    type: "string",
  },
  "phoenix-debug": YargsIntRange({
    default: 5,
    desc: "debug log level (higher number is more verbose)",
    min: 0,
    max: 9,
  }),
  "phoenix-pcf": {
    default: false,
    desc: "enable PCF",
    type: "boolean",
  },
  "phoenix-upf-workers": {
    default: 3,
    desc: "number of worker threads in UPF",
    type: "number",
  },
  "phoenix-upf-single-worker-n3": {
    defaultDescription: "true if phoenix-upf-workers is greater than 1",
    desc: "set N3 interface to single_thread mode",
    type: "boolean",
  },
  "phoenix-upf-single-worker-n9": {
    default: false,
    desc: "set N9 interface to single_thread mode",
    type: "boolean",
  },
  "phoenix-upf-single-worker-n6": {
    default: false,
    desc: "set N6 interface to single_thread mode",
    type: "boolean",
  },
  "phoenix-upf-taskset": tasksetOption("UPF"),
  "phoenix-upf-xdp": {
    default: false,
    desc: "enable XDP in UPF",
    type: "boolean",
  },
  "phoenix-gnb-workers": {
    default: 2,
    desc: "number of worker threads in gNB",
    type: "number",
  },
  "phoenix-gnb-taskset": tasksetOption("gNB"),
  "phoenix-ue-isolated": {
    array: true,
    default: [""],
    desc: "allocate a reserved CPU core to UEs matching SUPI suffix",
    nargs: 1,
    type: "string",
  },
});

export type PhoenixOpts = YargsInfer<typeof phoenixOptions>;

export function* tasksetScript(
    s: ComposeService,
    [mode, cnt]: PhoenixOpts["phoenix-upf-taskset"],
    nWorkers: number, workerPrefix: string,
): Iterable<string> {
  compose.annotate(s, "cpus", cnt + nWorkers);
  if (mode === "none") {
    return;
  }
  yield `/taskset.sh ${mode} ${cnt} ${workerPrefix} ${nWorkers} &`;
}

export const USIM = { sqn: "000000000001", amf: "8000" } as const;
