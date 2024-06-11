import path from "node:path";

import { Minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import * as shlex from "shlex";
import { sortBy } from "sort-by-typescript";
import assert from "tiny-invariant";

import { trafficGenerators } from "../trafficgen/pduperf-tg.js";
import type { ComposeFile, ComposeService } from "../types/mod.js";
import { scriptHead as baseScriptHead, type YargsInfer, type YargsOptions } from "../util/mod.js";
import { annotate } from "./compose.js";

interface PlaceRule {
  pattern: Minimatch;
  host: string;
  cpuset?: string;
}

/** Yargs options definition for placing Compose services onto multiple hosts. */
export const placeOptions = {
  place: {
    array: true,
    coerce(lines: readonly string[]): PlaceRule[] {
      return Array.from(lines, (line) => {
        const m = /^([^@]+)@([^@()]*)(?:\((\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\))?$/.exec(line);
        assert(m, `--place=${line} invalid`);
        const [, pattern, host, cpuset] = m as string[] as [string, string, string, string | undefined];
        return {
          pattern: new Minimatch(pattern),
          host,
          cpuset,
        };
      });
    },
    default: [],
    desc: "place containers on host and set CPU isolation",
    nargs: 1,
    type: "string",
  },
  "ssh-uri": {
    array: true,
    coerce(lines: readonly string[]): Record<string, string> {
      const map: Record<string, string> = {};
      for (const line of lines) {
        const m = /^([^=\s]+)\s*=\s*([^@\s]+@)?([^@:]+)?(:\d+)?$/.exec(line);
        assert(m, `--ssh-uri=${line} invalid`);
        const [, host, user = "", hostname = host, port = ""] =
          m as string[] as [string, string, string | undefined, string | undefined, string | undefined];
        map[host] = `${user}${hostname}${port}`;
      }
      return map;
    },
    desc: "change SSH username and port number",
    nargs: 1,
    type: "string",
  },
} as const satisfies YargsOptions;

/**
 * Place Compose services onto multiple hosts.
 * @returns A mapping from output filename to file contents.
 */
export function place(c: ComposeFile, opts: YargsInfer<typeof placeOptions>): void {
  if (opts.place.length === 0) {
    return;
  }

  const services = new Map<string, ComposeService>(
    Object.entries(c.services).filter(([, s]) => !annotate(s, "every_host")),
  );
  for (let { pattern, host, cpuset } of opts.place) {
    host = opts["ssh-uri"]?.[host] ?? host;
    const assignCpuset = cpuset ? new AssignCpuset(cpuset) : undefined;
    for (const [ct, s] of services) {
      if (pattern.match(ct)) {
        services.delete(ct);
        annotate(s, "host", host);
        assignCpuset?.prepare(s);
      }
    }
    assignCpuset?.update();
  }
  for (const s of services.values()) {
    annotate(s, "host", "");
  }
}

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

/** Make `docker` command with optional `-H` flag. */
export function makeDockerH(host: string | ComposeService | undefined): string {
  if (typeof (host as ComposeService | undefined)?.container_name === "string") {
    host = annotate(host as ComposeService, "host");
  }

  if (!host) {
    return "docker";
  }
  return `docker -H ssh://${host}`;
}

const trafficgenScripts = ["linkstat", "list-pdu", "nmap"];
const pduperfSubcommands = Object.keys(trafficGenerators);
pduperfSubcommands.sort((a, b) => a.localeCompare(b));

const scriptUsage = `Usage:
  ./compose.sh up
    Start the scenario.
  ./compose.sh down
    Stop the scenario.
  $(./compose.sh at CT) CMD
    Run Docker command CMD on the host machine of container CT.
  ./compose.sh upload
    Upload Compose context and Docker images to secondary hosts.
  ./compose.sh create
    Create scenario containers to prepare for traffic capture.
  ./compose.sh stop
    Stop and delete the containers, but keep the networks.
  ./compose.sh ps
    View containers on each host machine.
  ./compose.sh web
    View access instructions for web applications.
  ./compose.sh phoenix-register
    Register Open5GCore UEs.
  ./compose.sh linkstat
    Gather netif counters.

The following are available after UE registration and PDU session establishment:
  ./compose.sh list-pdu
    List PDU sessions.
  ./compose.sh nmap
    Run nmap ping scans from Data Network to UEs.
  ./compose.sh ${pduperfSubcommands.join("|")} FLAGS
    Prepare traffic generators.
`;

const codebaseRoot = path.join(import.meta.dirname, "..");

const scriptHead = [
  "#!/bin/bash",
  ...baseScriptHead,
  "cd \"$(dirname \"${BASH_SOURCE[0]}\")\"", // eslint-disable-line no-template-curly-in-string
  "COMPOSE_CTX=$PWD",
  "ACT=${1:-}", // eslint-disable-line no-template-curly-in-string
  "[[ -z $ACT ]] || shift",
];

const scriptTail = [
  "elif [[ $ACT == web ]]; then",
  "  msg Prometheus is at $(yq '.services.prometheus.annotations[\"5gdeploy.ip_meas\"]' compose.yml):9090",
  "  msg Grafana is at $(yq '.services.grafana.annotations[\"5gdeploy.ip_meas\"]' compose.yml):3000 , login with admin/grafana",
  "  msg free5GC WebUI is at $(yq '.services.webui.annotations[\"5gdeploy.ip_mgmt\"]' compose.yml):5000 , login with admin/free5gc",
  "  msg Setup SSH port forwarding to access these services in a browser",
  "  msg \"'null'\" means the relevant service has been disabled",
  "elif [[ $ACT == phoenix-register ]]; then",
  `  cd ${codebaseRoot}`,
  "  for UECT in $(docker ps --format='{{.Names}}' | grep '^ue'); do",
  "    msg Invoking Open5GCore UE registration and PDU session establishment in $UECT",
  "    corepack pnpm -s phoenix-rpc --host=$UECT ue-register --dnn='*'",
  "  done",
  `elif ${trafficgenScripts.map((tg) => `[[ $ACT == ${tg} ]]`).join(" || ")}; then`,
  `  $(env -C ${codebaseRoot} corepack pnpm bin)/tsx ${codebaseRoot}/trafficgen/$ACT.ts --dir=$COMPOSE_CTX "$@"`,
  `elif ${pduperfSubcommands.map((tg) => `[[ $ACT == ${tg} ]]`).join(" || ")}; then`,
  `  $(env -C ${codebaseRoot} corepack pnpm bin)/tsx ${codebaseRoot}/trafficgen/pduperf.ts --mode=$ACT --dir=$COMPOSE_CTX "$@"`,
  "else",
  `  echo ${shlex.quote(scriptUsage)}`,
  "  exit 1",
  "fi",
];

const scriptActions: ReadonlyArray<[act: string, cmd: string, listServiceNames: boolean, msg1: string, msg2: string]> = [
  ["create", "compose create", true, "Creating scenario containers", "Scenario containers have been created, ready for traffic capture"],
  ["up", "compose up -d", true, "Starting the scenario", "Scenario has started"],
  ["ps", "ps -a", false, "Checking containers", "If any container is 'Exited' with non-zero code, please investigate why it failed"],
  ["down", "compose down --remove-orphans", false, "Stopping the scenario", "Scenario has stopped"],
  ["stop", "compose rm -f -s", false, "Stopping scenario containers", "Scenario containers have been deleted"],
];

const minimalScript = [
  ...scriptHead,
  "if [[ $ACT == at ]]; then",
  "  echo docker",
  "elif [[ $ACT == upload ]]; then",
  "  true",
  ...scriptActions.flatMap(([act, cmd, , msg1, msg2]) => [
    `elif [[ $ACT == ${act} ]]; then`,
    `  msg ${shlex.quote(msg1)}`,
    `  docker ${cmd}`,
    `  msg ${shlex.quote(msg2)}`,
  ]),
  ...scriptTail,
].join("\n");

function* makeScriptLines(hostServices: readonly classifyByHost.Result[]): Iterable<string> {
  yield* scriptHead;

  yield "if [[ $ACT == at ]]; then";
  yield "  case ${1:-} in"; // eslint-disable-line no-template-curly-in-string
  for (const { dockerH, names } of hostServices) {
    yield `    ${names.join("|")}) echo ${shlex.quote(dockerH)};;`;
  }
  yield "    *) die Container not found;;";
  yield "  esac";

  yield "elif [[ $ACT == upload ]]; then";
  yield `  $(env -C ${codebaseRoot} corepack pnpm bin)/tsx ${codebaseRoot}/compose/upload.ts --dir=$COMPOSE_CTX`;
  yield `  ${path.join(import.meta.dirname, "../upload.sh")} $COMPOSE_CTX ${
    hostServices.map(({ host }) => host).join(" ")}`;

  for (const [act, cmd, listServiceNames, msg1, msg2] of scriptActions) {
    yield `elif [[ $ACT == ${act} ]]; then`;
    for (const { hostDesc, dockerH, names } of hostServices) {
      yield `  msg ${shlex.quote(`${msg1} on ${hostDesc}`)}`;
      yield `  ${dockerH} ${cmd}${listServiceNames ? ` ${names.join(" ")}` : ""}`;
    }
    yield `  msg ${shlex.quote(msg2)}`;
  }

  yield* scriptTail;
}

/** Generate compose.sh script. */
export function makeScript(c: ComposeFile): string {
  const hostServices = Array.from(classifyByHost(c));
  if (hostServices.length === 0) {
    return minimalScript;
  }
  hostServices.sort(sortBy("host"));
  return Array.from(makeScriptLines(hostServices)).join("\n");
}

/**
 * Gather services per host.
 * @param c - Compose file.
 * @param filter - Filter for container names.
 */
export function* classifyByHost(c: ComposeFile, filter = /^.*$/): Iterable<classifyByHost.Result> {
  const everyHostServices: ComposeService[] = [];
  const byHost = new DefaultMap<string, ComposeService[]>(() => []);
  for (const s of Object.values(c.services)) {
    if (!filter.test(s.container_name)) {
      continue;
    }

    if (annotate(s, "every_host")) {
      everyHostServices.push(s);
      continue;
    }

    const host = annotate(s, "host");
    if (host !== undefined) {
      byHost.get(host).push(s);
    }
  }

  for (const [host, hostServices] of byHost) {
    const services = [...everyHostServices, ...hostServices];
    services.sort(sortBy("container_name"));
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
