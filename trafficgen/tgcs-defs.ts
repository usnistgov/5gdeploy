import type { ReadonlyDeep } from "type-fest";

import type { ComposeFile, ComposeService } from "../types/mod.js";

/** Traffic direction. */
export enum Direction {
  dl = "DL>",
  ul = "<UL",
  bidir = "<->",
}
export namespace Direction {
  export function reverse(d: Direction): Direction {
    switch (d) {
      case Direction.dl: {
        return Direction.ul;
      }
      case Direction.ul: {
        return Direction.dl;
      }
      default: {
        return d;
      }
    }
  }
}

/** Traffic generator flow information. */
export interface TrafficGenFlowContext {
  c: ComposeFile;
  output: ComposeFile;
  prefix: string;
  group: string;
  port: number;
  dnService: ReadonlyDeep<ComposeService>;
  ueService: ReadonlyDeep<ComposeService>;
  dnIP: string;
  pduIP: string;
  cService: ReadonlyDeep<ComposeService>;
  cNetif: string;
  cIP: string;
  cFlags: readonly string[];
  sService: ReadonlyDeep<ComposeService>;
  sNetif: string;
  sIP: string;
  sFlags: readonly string[];
}

/** Traffic generator application. */
export interface TrafficGen {
  /** Determine traffic direction, upstream or downstream. */
  determineDirection: (flow: TrafficGenFlowContext) => Direction;

  /** Number of TCP/UDP ports needed per traffic flow. */
  nPorts: number;

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
   * Filename extension for statistics from `docker logs`.
   * This should start with ".".
   */
  statsExt: string;

  /**
   * bash commands to tally statistics and show on the console.
   * @param prefix - Service name prefix aka output folder name.
   */
  statsCommands?: (prefix: string) => Iterable<string>;
}

/** Mount /output volume. */
export function mountOutputVolume(s: ComposeService, prefix: string): void {
  s.volumes.push({
    type: "bind",
    source: `./${prefix}`,
    target: "/output",
    bind: { create_host_path: true },
  });
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
 * @returns - Transformed flags.
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
 * Extract a flag that starts with '#'.
 * @param flags - Input flags. #-flags must appear before other flags.
 * @param re - RegExp to match the desired #-flag.
 * @returns - Remaining flags with matched flag deleted; RegExp match result.
 */
export function extractHashFlag(flags: readonly string[], re: RegExp): [rflags: string[], m: RegExpMatchArray | undefined] {
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

/** Handle #start= flag for delayed client start. */
export class ClientStartOpt {
  constructor(private readonly s: ComposeService) {}
  private expr = "";

  /**
   * Extract #start= flag.
   * @param flags - Input flags.
   * @returns - Remaining flags.
   */
  public rewriteFlag(flags: readonly string[]): string[] {
    const [rflags, m] = extractHashFlag(flags, /^#start=(\$\w+|\+[.\d]+)$/);
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
