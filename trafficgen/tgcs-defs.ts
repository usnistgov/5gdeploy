import type { ReadonlyDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import type { ComposeFile, ComposeService, ComposeVolume } from "../types/mod.js";

/** Traffic direction. */
export enum Direction {
  dl = "DL>",
  ul = "<UL",
  bidir = "<->",
}
export namespace Direction {
  export function reverse(d: Direction): Direction {
    return ({ // eslint-disable-line @typescript-eslint/consistent-type-assertions
      [Direction.dl]: Direction.ul,
      [Direction.ul]: Direction.dl,
    } as Partial<Record<Direction, Direction>>)[d] ?? d;
  }
}

/** Traffic generator flow information. */
export interface TrafficGenFlowContext {
  /** Scenario Compose file. */
  readonly c: ComposeFile;
  /** Traffic generator Compose file. */
  readonly output: ComposeFile;
  /** Container name prefix, aka stats folder name. */
  readonly prefix: string;
  /** Group name, tgid + "_" + number. */
  readonly group: string;
  /** Base port number. */
  readonly port: number;
  /**
   * How many ports needed, initially 1.
   * If more ports are needed, overwrite in serverSetup or clientSetup.
   */
  nPorts: number;

  /** Client service, UE or DN. */
  readonly cService: ReadonlyDeep<ComposeService>;
  /** Client netif name. */
  readonly cNetif: string;
  /** Client bind IP. */
  readonly cIP: string;
  /** Client program flags. */
  readonly cFlags: readonly string[];

  /** Server service, DN or UE. */
  readonly sService: ReadonlyDeep<ComposeService>;
  /** Server netif name. */
  readonly sNetif: string;
  /** Server bind IP. */
  readonly sIP: string;
  /** Server program flags. */
  readonly sFlags: readonly string[];
  /** Traffic generator server, available in clientSetup when serverPerDN is false. */
  server?: ComposeService;
}

/** Traffic generator application. */
export interface TrafficGen {
  /** Descriptive name. */
  name?: string;

  /** Determine traffic direction, upstream or downstream. */
  determineDirection: (flow: TrafficGenFlowContext) => Direction;

  /**
   * Docker image.
   *
   * In case server and client require different Docker images, overwrite in clientSetup.
   */
  dockerImage: string;

  /**
   * If true, there's one server per Data Network.
   * Otherwise, there's one server per flow.
   */
  serverPerDN?: boolean;

  /** Procedure to setup a server container. */
  serverSetup: (s: ComposeService, flow: TrafficGenFlowContext) => void;

  /** Procedure to setup a client container. */
  clientSetup: (s: ComposeService, flow: TrafficGenFlowContext) => void;

  /**
   * bash commands to tally statistics and show on the console.
   * @param prefix - Service name prefix aka output folder name.
   */
  statsCommands?: (prefix: string) => Iterable<string>;
}

/** Mount /output volume. */
export function mountOutputVolume(s: ComposeService, prefix: string): ComposeVolume {
  const volume: ComposeVolume = {
    type: "bind",
    source: `./${prefix}`,
    target: "/output",
    bind: { create_host_path: true },
  };
  s.volumes.push(volume);
  return volume;
}

/**
 * Split flags as groups wrapped by "(#" and "#)".
 * @param flags - Input flags.
 * @returns Iterable that yields flag groups.
 *
 * @example
 * No grouping:
 * ```
 * splitFlagGroups(shlex.split("a b"))
 * // Yields:
 * // - ["a", "b"]
 * ```
 *
 * With grouping:
 * ```
 * splitFlagGroups(shlex.split("(# a b #) (# c d #)"))
 * // Yields:
 * // - ["a", "b"]
 * // - ["c", "d"]
 * ```
 */
export function* splitFlagGroups(flags: readonly string[]): Iterable<readonly string[]> {
  let hasGroups = false;
  let group: string[] = [];
  for (const flag of flags) {
    switch (flag) {
      case "(#": {
        hasGroups = true;
        group = [];
        break;
      }
      case "#)": {
        yield group;
        break;
      }
      default: {
        group.push(flag);
        break;
      }
    }
  }
  if (!hasGroups) {
    yield group;
  }
}

/**
 * Rewrite trafficgen flags so that output files are placed in the output folder.
 * @param s - Compose service for trafficgen client or server.
 * @param prefix - Service name prefix aka output folder name.
 * @param group - Flow group name.
 * @param port - Flow port number.
 * @param flags - Command line flags for client or server.
 * @param re - Regular expression to match output file flag name. It should have a capture group to identify file kind.
 * @param ext - Output file extension.
 * @returns Transformed flags.
 */
export function rewriteOutputFlag(s: ComposeService, prefix: string, group: string, port: number, flags: readonly string[], re: RegExp, ext: string): string[] {
  let hasOutput = false;
  const rFlags = flags.map((flag, i) => {
    const m = flags[i - 1]?.match(re);
    if (!m) {
      return flag;
    }
    hasOutput = true;
    return `/output/${group}-${port}-${m[1]}${ext}`;
  });

  if (hasOutput) {
    mountOutputVolume(s, prefix);
  }
  return rFlags;
}

/**
 * Extract a preprocessor flag that starts with '#'.
 * @param flags - Input flags. Preprocessor flags must appear before other flags.
 * @param re - RegExp to match the desired preprocessor flag.
 * @returns Remaining flags with matched flag deleted; RegExp match result.
 */
export function extractPpFlag(flags: readonly string[], re: RegExp): [rflags: string[], m: extractPpFlag.Match] {
  for (const [i, flag] of flags.entries()) {
    if (!flag.startsWith("#")) {
      break;
    }
    const m = re.exec(flag);
    if (m) {
      return [flags.toSpliced(i, 1), m];
    }
  }

  return [[...flags], undefined];
}
export namespace extractPpFlag {
  export type Match = RegExpMatchArray | undefined;
}

/** Handle #start= preprocessor flag for delayed client start. */
export class ClientStartOpt {
  constructor(private readonly s: ComposeService) {}
  private expr = "";

  /**
   * Extract #start= flag.
   * @param flags - Input flags.
   * @returns Remaining flags.
   */
  public rewriteFlag(flags: readonly string[]): string[] {
    const [rflags, m] = extractPpFlag(flags, /^#start=(\$\w+|\+[.\d]+)$/);
    if (m) {
      this.expr = m[1]!;
    }
    return rflags;
  }

  /** Generate commands to wait until requested client start time. */
  public *waitCommands(): Iterable<string> {
    if (this.expr.startsWith("$")) {
      this.s.environment[this.expr.slice(1)] = this.expr;
      yield `echo $(date -u +%s.%N) ${this.expr} | awk '{ d = $2 - $1; if (d > 0) { system(sprintf("sleep %0.9f", d)) } }'`;
    }

    if (this.expr.startsWith("+")) {
      this.s.environment.TGCS_T0 = "$TGCS_T0";
      const t = Number.parseFloat(this.expr);
      yield `echo $(date -u +%s.%N) $TGCS_T0 ${t.toFixed(3)} | awk '{ d = $2 + $3 - $1; if (d > 0) { system(sprintf("sleep %0.9f", d)) } }'`;
    }
  }
}

/** Handle #text flag and save "docker logs" file extension. */
export function handleTextOutputFlag(
    s: ComposeService, flags: readonly string[], nonTextStatsExt: string,
): [rflags: string[], wantText: boolean] {
  const [rflags, wantText] = extractPpFlag(flags, /^#text$/);
  if (!wantText) {
    compose.annotate(s, "tgcs_stats_ext", nonTextStatsExt);
  }
  return [rflags, !!wantText];
}
