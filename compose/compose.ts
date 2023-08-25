import yaml from "js-yaml";
import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import * as shlex from "shlex";

import type { ComposeFile, ComposeNetif, ComposeNetwork, ComposeService } from "../types/compose.js";

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

/** Generate commands to rename netifs. */
export function* renameNetifs(service: ComposeService): Iterable<string> {
  for (const [net, { ipv4_address }] of Object.entries(service.networks)) {
    yield `IFNAME=$(ip -o addr show to ${ipv4_address} | awk '{ print $2 }')`;
    yield `msg Renaming netif "$IFNAME" with IPv4 ${ipv4_address} to ${shlex.quote(net)}`;
    yield "ip link set dev \"$IFNAME\" down";
    yield `ip link set dev "$IFNAME" name ${shlex.quote(net)}`;
    yield `ip link set dev ${shlex.quote(net)} up`;
  }

  yield "unset $IFNAME";
  yield "msg Listing IP addresses";
  yield "ip addr list up";
  yield "msg Finished renaming netifs";
}

/**
 * Set commands on a service.
 * @param service Compose service to edit.
 * @param commands list of commands, '$' is escaped as '$$'.
 * @param shell should be set to 'ash' for alpine based images.
 */
export function setCommands(service: ComposeService, commands: Iterable<string>, shell = "bash"): void {
  const joined = [
    "set -euo pipefail",
    "msg() { echo -ne \"\\e[35m[5gdeploy] \\e[94m\"; echo -n \"$*\"; echo -e \"\\e[0m\"; }",
    ...commands,
  ].join(" ;\n").replaceAll("$", "$$$$");
  service.command = [`/bin/${shell}`, "-c", joined];
  service.entrypoint = [];
}
