import type { ReadonlyDeep } from "type-fest";

import type { ComposeFile, ComposeService } from "../types/mod.js";

/** Traffic direction. */
export enum Direction {
  dl = "DL>",
  ul = "<UL",
  bidir = "<->",
}

/** Traffic generator flow information. */
export interface TrafficGenFlowContext {
  c: ComposeFile;
  output: ComposeFile;
  prefix: string;
  group: string;
  port: number;
  dnIP: string;
  pduIP: string;
  cFlags: readonly string[];
  sFlags: readonly string[];
  dnService: ReadonlyDeep<ComposeService>;
  ueService: ReadonlyDeep<ComposeService>;
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

/** Handle #start= flag for delayed client start. */
export class ClientStartOpt {
  constructor(private readonly s: ComposeService) {}
  private varname = "";

  /** Delete #start= flag if it appears as the first client flag. */
  public rewriteFlag(flags: readonly string[]): string[] {
    const m = flags[0]?.match(/^#start=(\$\w+)$/);
    if (!m) {
      return [...flags];
    }
    this.varname = m[1]!;
    return flags.slice(1);
  }

  /** Generate commands to wait until requested client start time. */
  public *waitCommands(): Iterable<string> {
    if (!this.varname) {
      return;
    }
    this.s.environment[this.varname.slice(1)] = this.varname;
    yield `echo ${this.varname} $(date -u +%s.%N) | awk '{ d = $1 - $2; if (d > 0) { system("sleep " d) } }'`;
  }
}
