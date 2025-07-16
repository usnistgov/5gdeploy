import os from "node:os";

import { Minimatch } from "minimatch";
import { DefaultMap } from "mnemonist";
import { sortBy } from "sort-by-typescript";

import type { ComposeFile, ComposeService } from "../types/mod.js";
import { assert, parseCpuset, YargsCoercedArray, type YargsInfer, type YargsOptions } from "../util/mod.js";
import { annotate } from "./compose.js";

export interface PlaceRule {
  pattern: Minimatch;
  host: string;
  cpuset?: string;
}

export function parsePlaceRule(line: string): PlaceRule {
  const m = /^([^@]+)@([^@()]*)(?:\((\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\))?$/.exec(line);
  assert(m, `--place=${line} invalid`);
  const [, pattern, host, cpuset] = m as string[] as [string, string, string, string | undefined];
  return {
    pattern: new Minimatch(pattern),
    host,
    cpuset,
  };
}

/** Yargs options definition for placing Compose services onto multiple hosts. */
export const placeOptions = {
  place: YargsCoercedArray({
    coerce: parsePlaceRule,
    desc: "PATTERN@HOST(CPUSET), place containers on host and set CPU isolation",
  }),
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
  "place-match-host": {
    desc: "if true, HOST indicates a match condition instead of a placement instruction",
    hidden: true,
    type: "boolean",
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

  const services = new Map<string, ComposeService>(Object.entries(c.services).filter(([, s]) => !annotate(s, "every_host")));
  for (let { pattern, host, cpuset } of opts.place) {
    const assignCpus = cpuset === undefined ? undefined : new AssignCpuset(cpuset);
    host = opts["ssh-uri"]?.[host] ?? host;
    for (const [ct, s] of services) {
      if (pattern.match(ct) && (!opts["place-match-host"] || annotate(s, "host") === host)) {
        services.delete(ct);
        annotate(s, "host", host);
        assignCpus?.prepare(s);
      }
    }
    assignCpus?.update();
  }

  if (!opts["place-match-host"]) {
    for (const s of services.values()) {
      annotate(s, "host", "");
    }
  }
}

class AssignCpuset {
  constructor(cpuset: string) {
    this.avail = parseCpuset(cpuset);
  }

  public get cores(): number[] {
    return [...this.avail];
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

/** Build rclone SFTP backend options. */
export function makeRcloneSftpFlags(host: string): string[] {
  assert(!!host);
  const u = new URL(`ssh://${host}`);
  return [
    `--sftp-user=${u.username || os.userInfo().username}`,
    `--sftp-host=${u.hostname}`,
    ...(u.port ? [`--sftp-port=${u.port}`] : []),
    "--sftp-key-file=/sshkey",
  ];
}

/**
 * Gather services per host.
 * @param c - Compose file.
 * @param filter - Filter for container names.
 */
export function classifyByHost(
    c: ComposeFile,
    filter: (ct: string) => boolean = () => true,
): classifyByHost.Result[] {
  const everyHostServices: ComposeService[] = [];
  const byHost = new DefaultMap<string, ComposeService[]>(() => []);
  for (const s of Object.values(c.services)) {
    if (!filter(s.container_name)) {
      continue;
    }

    if (annotate(s, "every_host")) {
      everyHostServices.push(s);
      continue;
    }

    const host = annotate(s, "host") ?? "";
    byHost.get(host).push(s);
  }

  const result = Array.from(byHost, ([host, hostServices]): classifyByHost.Result => {
    const services = [...everyHostServices, ...hostServices];
    services.sort(sortBy("container_name"));
    return {
      host,
      hostDesc: host || "PRIMARY",
      dockerH: makeDockerH(host),
      services,
      names: services.map((s) => s.container_name),
    };
  });
  result.sort(sortBy("host"));
  return result;
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
