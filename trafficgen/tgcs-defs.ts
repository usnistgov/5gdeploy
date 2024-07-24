
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

export interface TrafficGen {
  determineDirection: (flow: TrafficGenFlowContext) => Direction;
  nPorts: number;
  serverDockerImage: string;
  serverPerDN?: boolean;
  serverSetup: (s: ComposeService, flow: TrafficGenFlowContext) => void;
  clientDockerImage: string;
  clientSetup: (s: ComposeService, flow: TrafficGenFlowContext) => void;
  statsExt: string;
  statsCommands?: (prefix: string) => Iterable<string>;
}

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
    s.volumes.push({
      type: "bind",
      source: `./${prefix}`,
      target: "/output",
    });
  }
  return rFlags;
}
