import yaml from "js-yaml";
import assert from "minimalistic-assert";
import { Netmask } from "netmask";

import type { ComposeFile, ComposeNetif, ComposeNetwork, ComposeService } from "../types/compose.js";

/** Derive network function name from container name. */
export function nameToNf(ct: string): string {
  return ct.replace(/(_.*|\d*)$/, "");
}

/**
 * Suggest container names for network function.
 * @param nf network function name.
 * @param list relevant config objects.
 * If a config object has a .name property, it must reflect the templated network function.
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

/** Create empty Compose file. */
export function create(): ComposeFile {
  return {
    networks: {},
    services: {},
  };
}

/** Parse Compose file from YAML string. */
export function parse(input: string): ComposeFile {
  const c = yaml.load(input) as ComposeFile;
  assert(c.networks);
  assert(c.services);
  return c;
}

/** Serialize Compose file as YAML string. */
export function save(c: ComposeFile): string {
  return yaml.dump(c, { forceQuotes: true, sortKeys: true });
}

/**
 * Define a Compose network.
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
    wantNAT?: boolean;
    mtu?: number;
  }
}

/**
 * Define a Compose service.
 * If a service with same name already exists, it is not replaced.
 */
export function defineService(c: ComposeFile, name: string, image: string): ComposeService {
  let service = c.services[name];
  service ??= {
    container_name: name,
    hostname: name,
    image: image,
    init: true,
    cap_add: [],
    devices: [],
    sysctls: {},
    volumes: [],
    environment: {},
    networks: {},
  };
  c.services[name] = service;
  return service;
}

/** Add a netif to a service. */
export function connectNetif(c: ComposeFile, ct: string, net: string, ip: string): ComposeNetif {
  const service = c.services[ct];
  assert(service, `service ${ct} missing`);
  const network = c.networks[net];
  assert(network, `network ${net} missing`);
  const subnet = new Netmask(network.ipam.config[0]?.subnet ?? "255.255.255.255/32");
  assert(subnet.contains(ip), `network ${net} subnet ${subnet} does not contain IP ${ip}`);
  const netif: ComposeNetif = { ipv4_address: ip };
  service.networks[net] = netif;
  return netif;
}

/**
 * Generate commands to rename netifs.
 * The container shall have NET_ADMIN capability.
 */
export function* renameNetifs(service: ComposeService, {
  pipeworkWait = false,
}: renameNetifs.Options = {}): Iterable<string> {
  for (const [net, { ipv4_address }] of Object.entries(service.networks)) {
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
    yield `  ip link set dev $IFNAME name ${net}`;
    yield `  ip link set dev ${net} up`;
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
     * Setting to true requires pipework to be installed in the container.
     * Default is false.
     */
    pipeworkWait?: boolean;
  }
}

/**
 * Set commands on a service.
 * @param service Compose service to edit.
 * @param commands list of commands.
 * @param shell should be set to 'ash' for alpine based images.
 */
export function setCommands(service: ComposeService, commands: Iterable<string>, shell = "bash"): void {
  const joined = [
    "set -euo pipefail",
    "msg() { echo -ne \"\\e[35m[5gdeploy] \\e[94m\"; echo -n \"$*\"; echo -e \"\\e[0m\"; }",
    "die() { msg \"$*\"; exit 1; }",
    ...commands,
  ].join("\n").replaceAll("$", "$$$$");
  service.command = [`/bin/${shell}`, "-c", joined];
  service.entrypoint = [];
}
