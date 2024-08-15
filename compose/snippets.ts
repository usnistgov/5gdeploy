import path from "node:path";

import * as shlex from "shlex";

import type { ComposeService } from "../types/mod.js";
import { assert, scriptHead } from "../util/mod.js";
import type { ComposeContext } from "./context.js";

/**
 * Set commands on a service.
 * @param s - Compose service to edit.
 * @param commands - List of commands.
 * @param shell - Shell program. This should be set to `ash` for alpine based images.
 */
export function setCommands(s: ComposeService, commands: Iterable<string>, shell = "bash"): void {
  const joined = [...scriptHead, ...commands].join("\n").replaceAll("$", "$$$$");
  s.command = [`/bin/${shell}`, "-c", joined];
  s.entrypoint = [];
}

export async function setCommandsFile(ctx: ComposeContext, s: ComposeService, commands: Iterable<string>, filename?: string, shell = "bash"): Promise<void> {
  filename ??= `${s.container_name}.sh`;
  await ctx.writeFile(filename, commands, { s, target: "/action.sh" });
  s.command = [`/bin/${shell}`, "/action.sh"];
  s.entrypoint = [];
}

/**
 * Generate commands to rename netifs to network names.
 * @param s - Compose service. NET_ADMIN capability is added.
 */
export function* renameNetifs(s: ComposeService, {
  disableTxOffload = false,
}: renameNetifs.Options = {}): Iterable<string> {
  s.cap_add.push("NET_ADMIN");

  for (const [net, { ipv4_address }] of Object.entries(s.networks)) {
    yield `IFNAME=$(ip -o addr show to ${ipv4_address} | awk '{ print $2 }')`;
    yield "if [[ -z $IFNAME ]]; then";
    yield `  msg Waiting for netif ${net} to appear`;
    yield `  with_retry ip link show dev ${net} &>/dev/null`;
    yield "  NETIF_WAITED=1";
    yield `elif [[ $IFNAME != ${net} ]]; then`;
    yield `  msg Renaming netif $IFNAME with IPv4 ${ipv4_address} to ${net}`;
    yield "  ip link set dev $IFNAME down";
    yield `  ip link set dev $IFNAME up name ${net}`;
    yield "fi";

    if (disableTxOffload) {
      yield `msg Disabling TX checksum offload on ${net}`;
      yield `ethtool --offload ${net} tx off || msg Cannot disable offload on ${net}, outgoing packets may get dropped`;
    }
  }

  yield "unset IFNAME";
  // eslint-disable-next-line no-template-curly-in-string
  yield "sleep ${NETIF_WAITED:-0}"; // give 1 second for newly appeared netifs to stabilize
  yield "msg Listing IP addresses";
  yield "ip addr list up";
  yield "msg Finished renaming netifs";
}
export namespace renameNetifs {
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
      yield `with_retry ping -c 1 -W 0.5 ${ip} &>/dev/null`;
    } else if (mode.startsWith("tcp:")) {
      yield `with_retry bash -c ${shlex.quote(`>/dev/tcp/${ip}/${mode.slice(4)}`)} &>/dev/null`;
    }
  }
  yield `msg The ${noun} ${verb} now reachable`;
  yield `sleep ${sleep}`;
}
export namespace waitReachable {
  export interface Options {
    /**
     * Reachability test mode: ICMP ping or TCP connect.
     */
    mode?: "icmp" | `tcp:${number}`;

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
export function* mergeConfigFile(cfg: unknown, { base, update, merged }: mergeConfigFile.Options): Iterable<string> {
  const ext = path.extname(base);
  const fmt = {
    ".json": "-oj",
    ".yaml": "",
    ".yml": "",
  }[ext];
  assert(fmt !== undefined, "unknown config file format");
  update ??= `/tmp/config-update${ext}`;

  if (typeof cfg === "string") {
    update = cfg;
  } else {
    yield `echo ${shlex.quote(JSON.stringify(cfg))} >${update}`;
  }
  yield `yq ${fmt} -P '. *= load("${update}") | ... comments=""' ${base} | tee ${merged}`;
}
export namespace mergeConfigFile {
  export interface Options {
    /** Base config filename from container image. */
    base: string;
    /** Update filename to be written. */
    update?: string;
    /** Merged filename. */
    merged: string;
  }
}
