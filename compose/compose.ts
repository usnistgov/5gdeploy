import yaml from "js-yaml";
import assert from "minimalistic-assert";
import { Netmask } from "netmask";

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

/** Define a Compose network. */
export function defineNetwork(c: ComposeFile, name: string, subnet: string, wantNAT = false): ComposeNetwork {
  const network: ComposeNetwork = {
    name: `br-${name}`,
    driver_opts: {
      "com.docker.network.bridge.name": `br-${name}`,
      "com.docker.network.bridge.enable_ip_masquerade": Number(wantNAT),
    },
    ipam: {
      driver: "default",
      config: [{ subnet }],
    },
  };
  c.networks[name] = network;
  return network;
}

/** Define a Compose service. */
export function defineService(c: ComposeFile, name: string, image: string): ComposeService {
  const service: ComposeService = {
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
