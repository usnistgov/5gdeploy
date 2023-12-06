import { minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import type { InferredOptionTypes, Options as YargsOptions } from "yargs";

import type { ComposeFile, ComposeService } from "../types/compose.js";

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
    const [pattern, host] = line.split("@") as [string, string];
    if (!pattern || host === undefined) {
      throw new Error(`--place=${line} invalid`);
    }
    for (const [ct, s] of services) {
      if (ct === "bridge") {
        //
      } else if (minimatch(ct, pattern)) {
        services.delete(ct);
      } else {
        continue;
      }
      hostServices.get(host)[ct] = s;
    }
  }
  for (const [ct, s] of services) {
    hostServices.get("")[ct] = s;
  }

  const ctl: string[] = [
    "#!/bin/bash",
    "set -euo pipefail",
    'cd "$(dirname "${BASH_SOURCE[0]}")"',
  ];
  for (const [host, services] of hostServices) {
    let filename = "compose.PRIMARY.yml";
    let flagH = "";
    if (host !== "") {
      filename = `compose.${host.replaceAll(/[^\da-z]/gi, "_")}.yml`;
      flagH = ` -H ssh://${host}`;
    }

    if (split) {
      outputFiles.set(filename, {
        networks: JSON.parse(JSON.stringify(c.networks)),
        services,
      } as ComposeFile);
      ctl.push(`docker${flagH} compose -f ${filename} "$@"`);
    } else {
      ctl.push(`docker${flagH} compose "$@" ${Object.keys(services).join(" ")}`);
    }
  }
  outputFiles.set("compose.sh", ctl.join("\n"));
  return outputFiles;
}
