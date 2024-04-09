import path from "node:path";

import assert from "minimalistic-assert";
import { Minimatch } from "minimatch";
import * as shlex from "shlex";

import type { ComposeFile, ComposeService } from "../types/mod.js";
import type { YargsInfer, YargsOptions } from "../util/mod.js";
import { annotate } from "./compose.js";

/** Shell script heading with common shell functions. */
export const scriptHead = [
  "set -euo pipefail",
  "msg() { echo -ne \"\\e[35m[5gdeploy] \\e[94m\"; echo -n \"$*\"; echo -e \"\\e[0m\"; }",
  "die() { msg \"$*\"; exit 1; }",
  "with_retry() { while ! \"$@\"; do sleep 0.2; done }",
];

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
 * Generate commands to alter outer IPv4 DSCP.
 * @param c - Compose file.
 * @param s - Compose service.
 * @param opts - Command line options.
 *
 * @remarks
 * This requires `iptables` to be installed in the container.
 */
export function* setDSCP(c: ComposeFile, s: ComposeService, opts: setDSCP.Options): Iterable<string> {
  for (const rule of opts["set-dscp"]) {
    if (!rule.src.match(s.container_name)) {
      continue;
    }
    const srcIP = annotate(s, `ip_${rule.net}`);
    assert(!!srcIP, `${s.container_name} does not have ${rule.net} netif`);

    for (const dst of Object.values(c.services)) {
      if (!rule.dst.match(dst.container_name)) {
        continue;
      }

      const dstIP = annotate(dst, `ip_${rule.net}`);
      assert(!!dstIP, `${dst.container_name} does not have ${rule.net} netif`);
      yield `iptables -t mangle -A OUTPUT -s ${srcIP} -d ${dstIP} -j DSCP --set-dscp ${rule.dscp}`;
    }
  }
}
export namespace setDSCP {
  export interface Rule {
    net: string;
    src: Minimatch;
    dst: Minimatch;
    dscp: number;
  }

  /** Yargs options for {@link setDSCP}. */
  export const options = {
    "set-dscp": {
      array: true,
      coerce(lines: readonly string[]): Rule[] {
        return Array.from(lines, (line) => {
          const tokens = line.split(",");
          assert(tokens.length === 4, `bad --set-dscp ${line}`);
          let dscp = Number.parseInt(tokens[3]!, 0); // eslint-disable-line radix
          if (Number.isNaN(dscp) && tokens[3]!.startsWith("cs")) {
            dscp = Number.parseInt(tokens[3]!.slice(2), 10) << 3;
          }
          assert(Number.isInteger(dscp) && dscp >= 0 && dscp < 64,
            `bad DSCP in --set-dscp ${line}`);
          return {
            net: tokens[0]!,
            src: new Minimatch(tokens[1]!),
            dst: new Minimatch(tokens[2]!),
            dscp,
          };
        });
      },
      default: [],
      desc: "alter outer IPv4 DSCP",
      nargs: 1,
      type: "string",
    },
  } satisfies YargsOptions;

  export type Options = YargsInfer<typeof options>;
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
  yield `yq ${fmt} -P '. *= load("${update}")' ${base} | tee ${merged}`;
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
