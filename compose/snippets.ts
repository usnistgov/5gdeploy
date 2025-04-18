import path from "node:path";

import stringify from "json-stringify-deterministic";
import { Netmask } from "netmask";
import * as shlex from "shlex";
import { sortBy } from "sort-by-typescript";

import type { ComposeService } from "../types/mod.js";
import { assert, scriptHead, scriptHeadStrict } from "../util/mod.js";
import { annotate } from "./compose.js";
import type { ComposeContext } from "./context.js";

/**
 * Set commands on a service.
 * @param s - Compose service to edit.
 * @param commands - List of commands.
 */
export function setCommands(s: ComposeService, commands: Iterable<string>, {
  shell = "bash",
  withScriptHead = true,
}: setCommands.Options = {}): void {
  const joined = [...(withScriptHead ? scriptHead : scriptHeadStrict), ...commands].join("\n").replaceAll("$", "$$$$");
  s.command = [`/bin/${shell}`, "-c", joined];
  s.entrypoint = [];
}
export namespace setCommands {
  export interface Options {
    /**
     * Shell program.
     * @defaultValue bash
     */
    shell?: "bash" | "ash";

    /**
     * Whether to include common shell functions in `scriptHead`.
     * @defaultValue true
     */
    withScriptHead?: boolean;
  }
}

/**
 * Set commands on a service via shell script file.
 * @param s - Compose service to edit.
 * @param commands - List of commands.
 */
export async function setCommandsFile(ctx: ComposeContext, s: ComposeService, commands: Iterable<string>, {
  shell = "bash",
  withScriptHead = true,
  filename = `${s.container_name}.sh`,
}: setCommandsFile.Options = {}): Promise<void> {
  await ctx.writeFile(
    filename,
    [...(withScriptHead ? scriptHead : scriptHeadStrict), ...commands],
    { executable: false, s, target: "/action.sh" },
  );
  s.command = [`/bin/${shell}`, "/action.sh"];
  s.entrypoint = [];
}
export namespace setCommandsFile {
  export interface Options extends setCommands.Options {
    /**
     * Script filename.
     * @defaultValue container_name.sh
     */
    filename?: string;
  }
}

/**
 * Generate commands to wait for netifs to become ready.
 * @param s - Compose service. NET_ADMIN capability is added.
 */
export function* waitNetifs(s: ComposeService, {
  disableTxOffload = false,
  ipCount = {},
}: waitNetifs.Options = {}): Iterable<string> {
  s.cap_add.push("NET_ADMIN");

  const netifAnnotatePrefix = `${annotate.PREFIX}ip_`;
  const netifs = Object.entries(s.annotations ?? {})
    .filter(([k]) => k.startsWith(netifAnnotatePrefix))
    .map(([k, v]): [string, string] => [k.slice(netifAnnotatePrefix.length), v]);
  netifs.sort(sortBy("0"));
  for (const [net, ip] of netifs) {
    if (annotate(s, `assume_net_${net}`)) {
      yield `msg Assuming network interface ${net} is manually setup`;
      continue;
    }

    yield `IFNAME=$(ip -o addr show to ${ip} | awk '{ print $2 }')`;
    yield "if [[ -z $IFNAME ]]; then";
    yield `  msg Waiting for netif ${net} to appear`;
    yield `  with_retry ip link show dev ${net} &>/dev/null`;
    yield "  NETIF_WAITED=1";
    yield `elif [[ $IFNAME != ${net} ]]; then`;
    yield `  die Found ${ip} on $IFNAME instead of ${net}`;
    yield "fi";

    if (disableTxOffload) {
      yield `msg Disabling TX checksum offload on ${net}`;
      yield `ethtool --offload ${net} tx off || msg Cannot disable offload on ${net}, outgoing packets may get dropped`;
    }

    const intfIPCount = ipCount[net] ?? 1;
    if (intfIPCount > 1) {
      yield `msg Adding extra IPs on ${net}`;
      let intfIP = new Netmask(ip, 32);
      for (let i = 1; i < intfIPCount; ++i) {
        intfIP = intfIP.next();
        yield `ip addr replace ${intfIP.base}/24 dev ${net}`;
      }
    }
  }

  yield "unset IFNAME";
  // eslint-disable-next-line no-template-curly-in-string
  yield "sleep ${NETIF_WAITED:-0}"; // give 1 second for newly appeared netifs to stabilize
  yield "msg Listing IP addresses";
  yield "ip addr list up";
  yield "msg All netifs are ready";
}
export namespace waitNetifs {
  export interface Options {
    /**
     * Whether to disable netif TX offload with ethtool.
     * @defaultValue false
     *
     * @remarks
     * Setting to true requires `ethtool` to be installed in the container. If ethtool is missing
     * or TX offload cannot be disabled, a warning is logged but it's not a fatal error.
     */
    disableTxOffload?: boolean;

    ipCount?: Record<string, number>;
  }
}

/**
 * Generate commands to wait for destination IPs to become reachable.
 * @param noun - Description, either singular (+"s" for plural) or singular+plural.
 * @param ips - IP addresses.
 */
export function* waitReachable(
    noun: string | [singular: string, plural: string],
    ips: readonly string[],
    { mode = "icmp", sleep = 5 }: waitReachable.Options = {},
): Iterable<string> {
  let verb = "is";
  switch (ips.length) {
    case 0: {
      return;
    }
    case 1: {
      noun = Array.isArray(noun) ? noun[0] : noun;
      break;
    }
    default: {
      noun = Array.isArray(noun) ? noun[1] : `${noun}s`;
      verb = "are";
      break;
    }
  }

  yield `msg Waiting for ${noun} to become reachable`;
  for (const ip of ips) {
    if (mode === "icmp") {
      yield `with_retry ping -c 1 -W 1 ${ip} &>/dev/null`;
    } else if (mode.startsWith("tcp:")) {
      yield `with_retry bash -c ${shlex.quote(`>/dev/tcp/${ip}/${mode.slice(4)}`)} &>/dev/null`;
    } else if (mode.startsWith("nc:")) {
      yield `with_retry nc -z ${shlex.quote(ip)} ${mode.slice(3)} &>/dev/null`;
    }
  }
  yield `msg The ${noun} ${verb} now reachable`;
  yield `sleep ${sleep}`;
}
export namespace waitReachable {
  export interface Options {
    /**
     * Reachability test mode:
     * - ICMP ping
     * - TCP connect, using bash
     * - TCP connect, using netcat
     *
     * @defaultValue icmp
     */
    mode?: "icmp" | `tcp:${number}` | `nc:${number}`;

    /**
     * Sleep duration after IPs become reachable.
     * @defaultValue 5
     */
    sleep?: number;
  }
}

/**
 * Generate commands to merge JSON/YAML configuration.
 * @param cfg - Config update object or mounted filename.
 * @returns Shell commands.
 *
 * @remarks
 * This requires `yq` to be installed in the container.
 */
export function* mergeConfigFile(
    cfg: unknown,
    { base, dels = [], op = "*", post = [], merged }: mergeConfigFile.Options,
): Iterable<string> {
  const fmt = {
    ".json": " -oj",
    ".yaml": "",
    ".yml": "",
  }[path.extname(base)];
  assert(fmt !== undefined, "unknown config file format");

  yield `yq${fmt} -P ${shlex.quote([
    "... comments=\"\"",
    ...Array.from(dels, (expr) => `del(${expr})`),
    `. ${op} ${typeof cfg === "string" ? `load(${JSON.stringify(cfg)})` : stringify(cfg)}`,
    "sort_keys(..)",
    ...post,
  ].join(" | "))} ${base} | tee ${merged}`;
}
export namespace mergeConfigFile {
  export interface Options {
    /** Base config filename from container image. */
    base: string;

    /**
     * Paths to delete.
     * @example
     * ```
     * [".smf.freeDiameter"]
     * ```
     */
    dels?: string[];

    /**
     * Merge operator.
     * @defaultValue "*"
     */
    op?: string;

    /**
     * Post operations, such as adding comments.
     * @example
     * ```
     * ["(.gnodeb.controlif | key) line_comment = \"172.25.198.18 ~ 172.25.198.21\""]
     * ```
     */
    post?: string[];

    /** Merged filename. */
    merged: string;
  }
}
