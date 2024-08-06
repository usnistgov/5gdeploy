import { Minimatch } from "minimatch";
import DefaultMap from "mnemonist/default-map.js";
import { sortBy } from "sort-by-typescript";

import type { ComposeFile, ComposeService } from "../types/mod.js";
import { assert, type YargsInfer, type YargsOptions } from "../util/mod.js";
import { annotate } from "./compose.js";

export interface PlaceRule {
  pattern: Minimatch;
  host: string;
  cpuset?: AssignCpuset;
}

export function parsePlaceRule(line: string): PlaceRule {
  const m = /^([^@]+)@([^@()]*)(?:\((\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\))?$/.exec(line);
  assert(m, `--place=${line} invalid`);
  const [, pattern, host, cpuset] = m as string[] as [string, string, string, string | undefined];
  return {
    pattern: new Minimatch(pattern),
    host,
    cpuset: cpuset === undefined ? undefined : new AssignCpuset(cpuset),
  };
}

/** Yargs options definition for placing Compose services onto multiple hosts. */
export const placeOptions = {
  place: {
    array: true,
    coerce(lines: readonly string[]): PlaceRule[] {
      return Array.from(lines, (line) => parsePlaceRule(line));
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
    for (const [ct, s] of services) {
      if (pattern.match(ct)) {
        services.delete(ct);
        annotate(s, "host", host);
        cpuset?.prepare(s);
      }
    }
    cpuset?.update();
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

  public get nAvail(): number {
    return this.avail.length;
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
