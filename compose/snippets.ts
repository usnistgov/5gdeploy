import path from "node:path";

import * as shlex from "shlex";
import assert from "tiny-invariant";

import type { ComposeService } from "../types/mod.js";
import { scriptHead } from "../util/mod.js";

/**
 * Set commands on a service.
 * @param service - Compose service to edit.
 * @param commands - List of commands.
 * @param shell - Shell program. This should be set to `ash` for alpine based images.
 */
export function setCommands(service: ComposeService, commands: Iterable<string>, shell = "bash"): void {
  const joined = [...scriptHead, ...commands].join("\n").replaceAll("$", "$$$$");
  service.command = [`/bin/${shell}`, "-c", joined];
  service.entrypoint = [];
}

/**
 * Generate commands to rename netifs to network names.
 * @param s - Compose service. NET_ADMIN capability is added.
 */
export function* renameNetifs(s: ComposeService, {
  pipeworkWait = false,
}: renameNetifs.Options = {}): Iterable<string> {
  s.cap_add.push("NET_ADMIN");

  for (const [net, { ipv4_address }] of Object.entries(s.networks)) {
    yield `IFNAME=$(ip -o addr show to ${ipv4_address} | awk '{ print $2 }')`;
    yield "if [[ -z $IFNAME ]]; then";
    if (pipeworkWait) {
      yield `  msg Waiting for netif ${net} to appear`;
      yield `  pipework --wait -i ${net}`;
    } else {
      yield `  die Missing netif ${net}`;
    }
    yield `elif [[ $IFNAME != ${net} ]]; then`;
    yield `  msg Renaming netif $IFNAME with IPv4 ${ipv4_address} to ${net}`;
    yield "  ip link set dev $IFNAME down";
    yield `  ip link set dev $IFNAME up name ${net}`;
    yield "fi";
  }

  yield "unset IFNAME";
  yield "msg Listing IP addresses";
  yield "ip addr list up";
  yield "msg Finished renaming netifs";
}
export namespace renameNetifs {
  export interface Options {
    /**
     * Whether to wait for netifs to appear with pipework.
     * @defaultValue false
     *
     * @remarks
     * Setting to true requires `pipework` to be installed in the container.
     */
    pipeworkWait?: boolean;
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
