import path from "node:path";

import assert from "minimalistic-assert";
import { minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import * as shlex from "shlex";

import type { ComposeFile, ComposeService } from "../types/mod.js";
import type { YargsInfer, YargsOptions } from "../util/mod.js";
import { annotate, scriptHead as baseScriptHead } from "./compose.js";

/** Yargs options definition for placing Compose services onto multiple hosts. */
export const placeOptions = {
  place: {
    default: [],
    desc: "place containers on host and set CPU isolation",
    nargs: 1,
    string: true,
    type: "array",
  },
  split: {
    default: false,
    desc: "generate a separate Compose file for each host",
    type: "boolean",
  },
} as const satisfies YargsOptions;

/**
 * Place Compose services onto multiple hosts.
 * @returns A mapping from output filename to file contents.
 */
export function place(c: ComposeFile, opts: YargsInfer<typeof placeOptions>): Map<string, unknown> {
  const outputFiles = new Map<string, unknown>([["compose.yml", c]]);
  if (opts.place.length === 0) {
    outputFiles.set("compose.sh", minimalScript);
    return outputFiles;
  }

  const services = new Map<string, ComposeService>(Object.entries(c.services));
  const hostServices = new DefaultMap<string, ComposeFile["services"]>(() => ({}));
  hostServices.set("", {});
  for (const line of opts.place) {
    const m = /^([^@]+)@([^@()]*)(?:\((\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\))?$/.exec(line);
    if (!m) {
      throw new Error(`--place=${line} invalid`);
    }
    const [, pattern, host, cpuset] = m as string[] as [string, string, string, string | undefined];
    const assignCpuset = cpuset ? new AssignCpuset(cpuset) : undefined;

    for (const [ct, s] of services) {
      if (ctEveryHost.has(ct)) {
        //
      } else if (minimatch(ct, pattern)) {
        services.delete(ct);
        annotate(s, "host", host);
      } else {
        continue;
      }
      assignCpuset?.prepare(s);
      hostServices.get(host)[ct] = s;
    }

    assignCpuset?.update();
  }
  for (const [ct, s] of services) {
    if (!ctEveryHost.has(ct)) {
      annotate(s, "host", "");
    }
    hostServices.get("")[ct] = s;
  }

  if (opts.split) {
    for (const [host, services] of hostServices) {
      outputFiles.set(makeFilename(host), {
        networks: JSON.parse(JSON.stringify(c.networks)),
        services,
      } as ComposeFile);
    }
  }
  outputFiles.set("compose.sh", Array.from(makeScript(hostServices, opts.split)).join("\n"));
  return outputFiles;
}

const ctEveryHost = new Set(["bridge"]);

class AssignCpuset {
  constructor(cpuset: string) {
    for (const token of cpuset.split(",")) {
      const [firstS, lastS] = token.split("-");
      const first = Number.parseInt(firstS!, 10);
      if (lastS === undefined) {
        this.avail.push(first);
        continue;
      }
      const last = Number.parseInt(lastS, 10);
      assert(first <= last, "bad cpuset");
      for (let i = first; i <= last; ++i) {
        this.avail.push(i);
      }
    }
  }

  private readonly avail: number[] = [];
  private shared?: string;

  private readonly services = new Map<string, ComposeService>();
  private wantShared = false;
  private wantDedicated = 0;

  public prepare(s: ComposeService): void {
    if (ctEveryHost.has(s.container_name)) {
      return;
    }

    this.services.set(s.container_name, s);
    const wanted = Number.parseInt(annotate(s, "cpus") ?? "0", 10);
    if (wanted === 0) {
      this.wantShared = true;
    } else {
      this.wantDedicated += wanted;
    }
  }

  private alloc(n: number): string {
    assert(n <= this.avail.length);
    return this.avail.splice(0, n).join(",");
  }

  public update(): void {
    if (this.wantShared || this.wantDedicated > this.avail.length) {
      this.shared ??= this.alloc(Math.min(2, this.avail.length));
    }

    for (const s of this.services.values()) {
      const wanted = Number.parseInt(annotate(s, "cpus") ?? "0", 10);
      if (wanted === 0) {
        s.cpuset = this.shared!;
      } else if (wanted > this.avail.length) {
        s.cpuset = this.shared;
        annotate(s, "cpuset_warning", "insufficient-using-shared");
      } else {
        s.cpuset = this.alloc(wanted);
      }
    }
  }
}

function makeFilename(host: string): string {
  if (!host) {
    return "compose.PRIMARY.yml";
  }
  return `compose.${host.replaceAll(/\W/g, "_")}.yml`;
}

/** Make `docker` command with optional `-H` flag. */
export function makeDockerH(host?: string | ComposeService): string {
  if (typeof (host as ComposeService | undefined)?.container_name === "string") {
    host = annotate(host as ComposeService, "host");
  }

  if (!host) {
    return "docker";
  }
  return `docker -H ssh://${host}`;
}

const scriptUsage = `Usage:
  ./compose.sh up
    Start the scenario.
  ./compose.sh down
    Stop the scenario.
  $(./compose.sh at CT) CMD
    Run Docker command CMD on the host machine of container CT.
  ./compose.sh create
    Create scenario containers to prepare for traffic capture.
  ./compose.sh phoenix-register
    Register Open5GCore UEs.
  ./compose.sh iperf3
    Prepare iperf3.sh traffic generation script.
    The scenario must be started and the PDU sessions must be established.
`;

const scriptHead = [
  "#!/bin/bash",
  ...baseScriptHead,
  "cd \"$(dirname \"${BASH_SOURCE[0]}\")\"", // eslint-disable-line no-template-curly-in-string
  "COMPOSE_CTX=$PWD",
  "ACT=${1:-}", // eslint-disable-line no-template-curly-in-string
  "shift",
];

const scriptTail = [
  "elif [[ $ACT == phoenix-register ]]; then",
  `  cd ${path.join(import.meta.dirname, "..")}`,
  "  for UECT in $(docker ps --format='{{.Names}}' | grep '^ue'); do",
  "    corepack pnpm -s phoenix-rpc --host=$UECT ue-register --dnn='*'",
  "  done",
  "elif [[ $ACT == iperf3 ]]; then",
  `  cd ${path.join(import.meta.dirname, "..")}`,
  "  $(corepack pnpm bin)/tsx trafficgen/iperf3-prepare.ts --dir=$COMPOSE_CTX \"$@\"",
  "else",
  `  echo ${shlex.quote(scriptUsage)}`,
  "  exit 1",
  "fi",
];

const minimalScript = [
  ...scriptHead,
  "if [[ $ACT == at ]]; then",
  "  echo docker",
  "elif [[ $ACT == create ]]; then",
  "  docker compose create",
  "elif [[ $ACT == up ]]; then",
  "  docker compose up -d",
  "elif [[ $ACT == down ]]; then",
  "  docker compose down --remove-orphans",
  ...scriptTail,
].join("\n");

function* makeScript(hostServices: Iterable<[host: string, services: ComposeFile["services"]]>, split: boolean): Iterable<string> {
  yield* scriptHead;

  yield "if [[ $ACT == at ]]; then";
  yield "  case ${2:-} in"; // eslint-disable-line no-template-curly-in-string
  for (const [host, services] of hostServices) {
    yield `    ${Object.keys(services).join("|")}) echo ${makeDockerH(host)};;`;
  }
  yield "    *) die Container not found;;";
  yield "  esac";

  for (const [act, cmd, listServiceNames, msg1, msg2] of [
    ["create", "create", true, "Creating scenario containers", "Scenario containers have been created, ready for traffic capture"],
    ["up", "up -d", true, "Starting the scenario", "Scenario has started"],
    ["down", "down --remove-orphans", false, "Stopping the scenario", "Scenario has stopped"],
  ] as const) {
    yield `elif [[ $ACT == ${act} ]]; then`;
    for (const [host, services] of hostServices) {
      yield `  msg ${shlex.quote(msg1)} on ${host || "PRIMARY"}`;
      yield `  ${makeDockerH(host)} compose${split ? ` -f ${makeFilename(host)}` : ""} ${cmd}${
        listServiceNames ? ` ${Object.keys(services).join(" ")}` : ""}`;
    }
    if (msg2) {
      yield `  msg ${shlex.quote(msg2)}`;
    }
  }

  yield* scriptTail;
}

/**
 * Gather services per host.
 * @param c - Compose file.
 * @param filter - Filter for container names.
 */
export function* classifyByHost(c: ComposeFile, filter = /^.*$/): Iterable<classifyByHost.Result> {
  const services = Object.values(c.services).filter(({ container_name }) => filter.test(container_name));
  const byHost = new DefaultMap<string, ComposeService[]>(() => []);
  for (const s of services) {
    const host = annotate(s, "host");
    if (host === undefined) {
      continue;
    }
    byHost.get(host).push(s);
  }
  for (const [host, services] of byHost) {
    yield {
      host,
      hostDesc: host || "PRIMARY",
      dockerH: makeDockerH(host),
      services,
      names: services.map((s) => s.container_name),
    };
  }
}
export namespace classifyByHost {
  export interface Result {
    /** Host name, "" for primary. */
    host: string;
    /** Host description, "PRIMARY" for primary. */
    hostDesc: string;
    /** `docker -H` command line. */
    dockerH: string;
    /** Services. */
    services: readonly ComposeService[];
    /** Container names. */
    names: readonly string[];
  }
}
