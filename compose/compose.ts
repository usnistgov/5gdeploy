import path from "node:path";

import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import * as shlex from "shlex";
import type { ConditionalKeys } from "type-fest";

import type { ComposeFile, ComposeNetif, ComposeNetwork, ComposeService } from "../types/mod.js";

/** Derive network function name from container name. */
export function nameToNf(ct: string): string {
  return ct.replace(/(_.*|\d*)$/, "");
}

/**
 * Suggest container names for network function.
 * @param nf - Network function name.
 * @param list - Relevant config objects.
 *
 * @remarks
 * If a config object has a `.name` property, it must reflect the templated network function.
 */
export function suggestNames<T>(nf: string, list: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const [i, item] of list.entries()) {
    const { name } = (item as { name?: unknown });
    const ct = typeof name === "string" ? name : `${nf}${i}`;
    assert(nameToNf(ct) === nf);
    m.set(ct, item);
  }
  return m;
}

/** Suggest container names for UE simulators. */
export function suggestUENames<T extends { supi: string }>(list: readonly T[]): Map<string, T> {
  let commonPrefix: string | undefined;
  for (const { supi } of list) {
    commonPrefix ??= supi.slice(0, -1);
    while (!supi.startsWith(commonPrefix)) {
      commonPrefix = commonPrefix.slice(0, -1);
    }
  }

  const m = new Map<string, T>();
  for (const item of list) {
    m.set(`ue${item.supi.slice(commonPrefix!.length)}`, item);
  }
  return m;
}

/** Create an empty Compose file. */
export function create(): ComposeFile {
  return {
    networks: {},
    services: {},
  };
}

/**
 * Define a Compose network.
 *
 * @remarks
 * If a network with same name already exists, it is not replaced.
 */
export function defineNetwork(c: ComposeFile, name: string, subnet: string, {
  wantNAT = false,
  mtu = 1500,
}: defineNetwork.Options = {}): ComposeNetwork {
  let network = c.networks[name];
  network ??= {
    name: `br-${name}`,
    driver_opts: {
      "com.docker.network.bridge.name": `br-${name}`,
      "com.docker.network.bridge.enable_ip_masquerade": Number(wantNAT),
      "com.docker.network.driver.mtu": mtu,
    },
    ipam: {
      driver: "default",
      config: [{ subnet }],
    },
  };
  c.networks[name] = network;
  return network;
}
export namespace defineNetwork {
  export interface Options {
    /**
     * Whether to enable IPv4 NAT, which allows Internet access.
     * @defaultValue false
     */
    wantNAT?: boolean;

    /**
     * Network interface MTU.
     * @defaultValue 1500
     */
    mtu?: number;
  }
}

/**
 * Define a Compose service.
 *
 * @remarks
 * If a service with same name already exists, it is not replaced.
 */
export function defineService(c: ComposeFile, name: string, image: string): ComposeService {
  let s = c.services[name];
  if (s === undefined) {
    s = {
      container_name: name,
      hostname: name,
      image: image,
      init: true,
      cap_add: [],
      devices: [],
      sysctls: {},
      volumes: [],
      environment: {
        HTTP_PROXY: "",
        http_proxy: "",
        HTTPS_PROXY: "",
        https_proxy: "",
      },
      networks: {},
      ports: [],
    };
    attachServiceValidations(s);
    c.services[name] = s;
  }
  return s;
}

function attachServiceValidations(s: ComposeService): void {
  for (const key of [
    "sysctls", "environment", "networks",
  ] as const satisfies ReadonlyArray<ConditionalKeys<ComposeService, Record<string, unknown>>>) {
    Object.defineProperty(s, key, {
      enumerable: true,
      writable: false,
      value: s[key],
    });
  }

  for (const [key, uniq] of [
    ["cap_add", true], ["devices", true], ["volumes", false], ["ports", false],
  ] as const satisfies ReadonlyArray<[key: ConditionalKeys<ComposeService, unknown[]>, uniq: boolean]>) {
    Object.defineProperty(s, key, {
      enumerable: true,
      writable: false,
      value: s[key],
    });
    if (uniq) {
      Object.defineProperty(s[key], "push", {
        enumerable: false,
        value: function<T>(this: T[], ...items: T[]): number {
          return Array.prototype.push.apply(this, items.filter((item) => !this.includes(item)));
        },
      });
    }
  }

  let networkMode: string | undefined;
  Object.defineProperty(s, "network_mode", {
    enumerable: true,
    get() {
      return networkMode;
    },
    set(value?: string) {
      networkMode = value;
      if (value) {
        s.hostname = "";
        assert(Object.keys(s.networks).length === 0,
          "cannot set ComposeService.network_mode with non-empty ComposeService.networks");
      }
    },
  });
}

/** Get service annotation. */
export function annotate(s: ComposeService, key: string): string | undefined;
/** Set service annotation. */
export function annotate(s: ComposeService, key: string, value: string | number): ComposeService;

export function annotate(s: ComposeService, key: string, value?: string | number) {
  key = `5gdeploy.${key}`;
  if (value === undefined) {
    return s.annotations?.[key];
  }

  s.annotations ??= {};
  s.annotations[key] = `${value}`;
  return s;
}

/**
 * List services whose annotation matching a predicate.
 * @param c - Compose file.
 * @param key - Annotation key.
 * @param predicate - Expected value or predicate function.
 * @returns List of matched services.
 */
export function listByAnnotation(
    c: ComposeFile, key: string,
    predicate: string | number | ((value: string) => boolean),
): ComposeService[] {
  key = `5gdeploy.${key}`;
  if (typeof predicate !== "function") {
    const expected = `${predicate}`;
    predicate = (v) => v === expected;
  }

  return Object.values(c.services).filter((s) => {
    const value = s.annotations?.[key];
    return value !== undefined && predicate(value);
  });
}

/** Add a netif to a service. */
export function connectNetif(c: ComposeFile, ct: string, net: string, ip: string): ComposeNetif {
  const s = c.services[ct];
  assert(s, `service ${ct} missing`);
  const network = c.networks[net];
  assert(network, `network ${net} missing`);
  const subnet = new Netmask(network.ipam.config[0]?.subnet ?? "255.255.255.255/32");
  assert(subnet.contains(ip), `network ${net} subnet ${subnet} does not contain IP ${ip}`);
  const netif: ComposeNetif = { ipv4_address: ip };
  s.networks[net] = netif;
  annotate(s, `ip_${net}`, ip);
  return netif;
}

/** Remove a netif from a service. */
export function disconnectNetif(c: ComposeFile, ct: string, net: string): string {
  const service = c.services[ct];
  assert(service, `service ${ct} missing`);
  const netif = service.networks[net];
  assert(netif, `netif ${ct}:${net} missing`);
  delete service.networks[net]; // eslint-disable-line @typescript-eslint/no-dynamic-delete

  const sysctlPrefix = `net.ipv4.conf.eth${Object.entries(service.networks).length}.`;
  for (const key of Object.keys(service.sysctls)) {
    if (key.startsWith(sysctlPrefix)) {
      delete service.sysctls[key]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
    }
  }

  return netif.ipv4_address;
}

/**
 * Generate commands to rename netifs to network names.
 * @param s  - Compose service. NET_ADMIN capability is added.
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

/** Expose a container port on the host. */
export function exposePort(s: ComposeService, port: number, protocol = "tcp"): void {
  s.ports.push({
    protocol,
    target: port,
    mode: "host",
    host_ip: "0.0.0.0",
    published: `${port}`,
  });
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
