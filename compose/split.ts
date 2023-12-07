import assert from "minimalistic-assert";
import { minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import type { InferredOptionTypes, Options as YargsOptions } from "yargs";

import type { ComposeFile, ComposeService } from "../types/compose.js";
import { annotate } from "./compose.js";

export const splitOptions = {
  place: {
    desc: "place containers on host",
    nargs: 1,
    string: true,
    type: "array",
  },
  split: {
    default: false,
    desc: "generate a separate Compose file for each host",
    type: "boolean",
  },
} as const satisfies Record<string, YargsOptions>;

export function splitOutput(c: ComposeFile, { place = [], split }: InferredOptionTypes<typeof splitOptions>): Map<string, unknown> {
  const outputFiles = new Map<string, unknown>([["compose.yml", c]]);
  if (place.length === 0) {
    return outputFiles;
  }

  const services = new Map<string, ComposeService>(Object.entries(c.services));
  const hostServices = new DefaultMap<string, ComposeFile["services"]>(() => ({}));
  for (const line of place) {
    const m = /^([^@]+)@([^@()]*)(?:\((\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\))?$/.exec(line);
    if (!m) {
      throw new Error(`--place=${line} invalid`);
    }
    const [, pattern, host, cpuset] = m as string[] as [string, string, string, string | undefined];
    const assignCpuset = new AssignCpuset(cpuset);

    for (const [ct, s] of services) {
      if (ct === "bridge") {
        //
      } else if (minimatch(ct, pattern)) {
        services.delete(ct);
        annotate(s, "host", host);
      } else {
        continue;
      }
      hostServices.get(host)[ct] = assignCpuset.update(s);
    }
  }
  for (const [ct, s] of services) {
    annotate(s, "host", "");
    hostServices.get("")[ct] = s;
  }

  const sh: string[] = [
    "#!/bin/bash",
    "set -euo pipefail",
    "cd \"$(dirname \"${BASH_SOURCE[0]}\")\"", // eslint-disable-line no-template-curly-in-string
  ];
  for (const [host, services] of hostServices) {
    let filename = "compose.PRIMARY.yml";
    let flagH = "";
    if (host !== "") {
      filename = `compose.${host.replaceAll(/\W/g, "_")}.yml`;
      flagH = ` -H ssh://${host}`;
    }

    if (split) {
      outputFiles.set(filename, {
        networks: JSON.parse(JSON.stringify(c.networks)),
        services,
      } as ComposeFile);
      sh.push(`docker${flagH} compose -f ${filename} "$@"`);
    } else {
      sh.push(`docker${flagH} compose "$@" ${Object.keys(services).join(" ")}`);
    }
  }
  outputFiles.set("compose.sh", sh.join("\n"));
  return outputFiles;
}

class AssignCpuset {
  constructor(cpuset?: string) {
    if (!cpuset) {
      return;
    }
    this.enabled = true;
    for (const token of cpuset.split(",")) {
      const [firstS, lastS] = token.split("-");
      const first = Number.parseInt(firstS!, 10);
      if (lastS === undefined) {
        this.unused.push(first);
        continue;
      }
      const last = Number.parseInt(lastS, 10);
      assert(first <= last, "bad cpuset");
      for (let i = first; i <= last; ++i) {
        this.unused.push(i);
      }
    }

    this.shared = this.unused.splice(0, 2).join(",");
  }

  private readonly enabled: boolean = false;
  private readonly unused: number[] = [];
  private readonly shared: string = "";

  public update(s: ComposeService): ComposeService {
    if (!this.enabled) {
      return s;
    }

    const wanted = Number.parseInt(annotate(s, "cpus") ?? "0", 10);
    if (wanted === 0) {
      s.cpuset = this.shared;
    } else if (this.unused.length < wanted) {
      s.cpuset = this.shared;
      annotate(s, "cpuset_warning", "insufficient-using-shared");
    } else {
      s.cpuset = this.unused.splice(0, wanted).join(",");
    }
    return s;
  }
}
