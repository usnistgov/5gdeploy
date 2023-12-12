import assert from "minimalistic-assert";
import { minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import * as shlex from "shlex";
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
    outputFiles.set("compose.sh", minimalScript);
    return outputFiles;
  }

  const services = new Map<string, ComposeService>(Object.entries(c.services));
  const hostServices = new DefaultMap<string, ComposeFile["services"]>(() => ({}));
  hostServices.set("", {});
  for (const line of place) {
    const m = /^([^@]+)@([^@()]*)(?:\((\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\))?$/.exec(line);
    if (!m) {
      throw new Error(`--place=${line} invalid`);
    }
    const [, pattern, host, cpuset] = m as string[] as [string, string, string, string | undefined];
    const assignCpuset = new AssignCpuset(cpuset);

    for (const [ct, s] of services) {
      if (ctEveryHost.has(ct)) {
        //
      } else if (minimatch(ct, pattern)) {
        services.delete(ct);
        annotate(s, "host", host);
      } else {
        continue;
      }
      hostServices.get(host)[ct] = assignCpuset.update(ct, s);
    }
  }
  for (const [ct, s] of services) {
    if (!ctEveryHost.has(ct)) {
      annotate(s, "host", "");
    }
    hostServices.get("")[ct] = s;
  }

  if (split) {
    for (const [host, services] of hostServices) {
      outputFiles.set(makeFilename(host), {
        networks: JSON.parse(JSON.stringify(c.networks)),
        services,
      } as ComposeFile);
    }
  }
  outputFiles.set("compose.sh", Array.from(makeScript(hostServices, split)).join("\n"));
  return outputFiles;
}

const ctEveryHost = new Set(["bridge"]);

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

  public update(ct: string, s: ComposeService): ComposeService {
    if (!this.enabled || ctEveryHost.has(ct)) {
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

function makeFilename(host: string): string {
  if (!host) {
    return "compose.PRIMARY.yml";
  }
  return `compose.${host.replaceAll(/\W/g, "_")}.yml`;
}

function makeFlagH(host: string): string {
  if (!host) {
    return "";
  }
  return ` -H ssh://${host}`;
}

const scriptHead = [
  "#!/bin/bash",
  "set -euo pipefail",
  "cd \"$(dirname \"${BASH_SOURCE[0]}\")\"", // eslint-disable-line no-template-curly-in-string
  "msg() { echo -ne \"\\e[35m[5gdeploy] \\e[94m\"; echo -n \"$*\"; echo -e \"\\e[0m\"; }",
  "die() { msg \"$*\"; exit 1; }",
  "ACT=${1:-}", // eslint-disable-line no-template-curly-in-string
];

const scriptUsage = `Usage:
  ./compose.sh up
  ./compose.sh down
  $(./compose.sh at CT) CMD`;

const minimalScript = [
  ...scriptHead,
  "case $ACT in",
  "  at) echo docker;;",
  "  up) docker compose up -d;;",
  "  down) docker compose down --remove-orphans;;",
  `  *) echo ${shlex.quote(scriptUsage)}; exit 1;;`,
  "esac",
].join("\n");

function* makeScript(hostServices: Iterable<[host: string, services: ComposeFile["services"]]>, split: boolean): Iterable<string> {
  yield* scriptHead;

  yield "if [[ $ACT == at ]]; then";
  yield "  case ${2:-} in"; // eslint-disable-line no-template-curly-in-string
  for (const [host, services] of hostServices) {
    yield `    ${Object.keys(services).join("|")}) echo docker${makeFlagH(host)};;`;
  }
  yield "    *) die Container not found;;";
  yield "  esac";

  for (const [act, cmd] of [["up", "up -d"], ["down", "down --remove-orphans"]]) {
    yield `elif [[ $ACT == ${act} ]]; then`;
    for (const [host, services] of hostServices) {
      yield `  msg Bringing ${act} the scenario on ${host || "PRIMARY"}`;
      if (split) {
        yield `  docker${makeFlagH(host)} compose -f ${makeFilename(host)} ${cmd}`;
      } else {
        yield `  docker${makeFlagH(host)} compose ${cmd} ${Object.keys(services).join(" ")}`;
      }
    }
    yield `  msg Scenario has been brought ${act}`;
  }

  yield "else";
  yield `  echo ${shlex.quote(scriptUsage)}`;
  yield "  exit 1";
  yield "fi";
}
