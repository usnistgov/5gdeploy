import stringify from "json-stringify-deterministic";
import { ip2long, Netmask } from "netmask";
import { filter, take } from "obliterator";
import type { ConditionalKeys, ReadonlyDeep } from "type-fest";

import type { ComposeFile, ComposeNamedVolume, ComposeNetwork, ComposePort, ComposeService, ComposeVolume } from "../types/mod.js";
import { assert, hexPad } from "../util/mod.js";

/** Derive network function name from container name. */
export function nameToNf(ct: string): string {
  return ct.replace(/(_.*|\d*)$/, "");
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
    volumes: {},
    networks: {},
    services: {},
  };
}

/**
 * Define a Compose named volume.
 *
 * @remarks
 * If a volume with same name already exists, it is not replaced.
 */
export function defineVolume(c: ComposeFile, id: string, name = id): ComposeNamedVolume {
  return (c.volumes[id] ??= { name });
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
      "com.docker.network.bridge.gateway_mode_ipv4": wantNAT ? "nat-unprotected" : "routed",
      "com.docker.network.bridge.gateway_mode_ipv6": "routed",
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
 * Define a Compose service if it does not yet exist.
 *
 * @returns
 * New or existing ComposeService.
 *
 * The returned object has certain enhanced semantics:
 * - `.network_mode` defaults to "none", but will be cleared if a network interface is connected
 *   via {@link connectNetif}.
 * - If `.network_mode` is changed to "host" or pointing to another container, "net.*" entries are
 *   deleted from `.sysctls` because they will not be allowed by Docker.
 * - `.cap_add`, `.devices`, `.volumes`, and `.ports` are deduplicated via their `push` method.
 */
export function defineService(c: ComposeFile, name: string, image: string): ComposeService {
  return (c.services[name] ??= createService(name, image));
}

function createService(name: string, image: string): ComposeService {
  const s: ComposeService = {
    container_name: name,
    hostname: name,
    image,
    init: true,
    stop_signal: "SIGTERM",
    cap_add: [],
    devices: [],
    sysctls: {
      "net.ipv4.conf.all.arp_filter": 1,
      "net.ipv4.conf.all.forwarding": 0,
      "net.ipv4.conf.all.rp_filter": 2,
      "net.ipv4.conf.default.rp_filter": 2,
      "net.ipv6.conf.all.forwarding": 0,
      "net.ipv6.conf.default.disable_ipv6": 1,
    },
    volumes: [],
    environment: {
      HTTP_PROXY: "",
      http_proxy: "",
      HTTPS_PROXY: "",
      https_proxy: "",
    },
    network_mode: "none",
    networks: {},
    ports: [],
    extra_hosts: {},
    depends_on: {},
  };

  for (const [key, uniqBy] of [
    ["cap_add", (cap: string) => cap],
    ["devices", (device: string) => device.split(":")[1]!],
    ["volumes", (vol: ComposeVolume) => vol.target],
    ["ports", (port: ComposePort) => `${port.target}/${port.protocol}`],
  ] as ReadonlyArray<[
      key: ConditionalKeys<ComposeService, unknown[]>,
      uniqBy: (value: any) => string,
  ]>) {
    Object.defineProperty(s[key], "push", {
      enumerable: false,
      value: function<T>(this: T[], ...items: T[]): number {
        const existing = new Map<string, T>();
        for (const item of this) {
          existing.set(uniqBy(item), item);
        }
        return Array.prototype.push.apply(this, items.filter((item) => {
          const old = existing.get(uniqBy(item));
          if (old) {
            const oldS = stringify(old);
            const newS = stringify(item);
            assert(oldS === newS, `${key} item ${newS} conflicts with ${oldS}`);
            return false;
          }
          return true;
        }));
      },
    });
  }

  let networkMode = s.network_mode;
  Object.defineProperty(s, "network_mode", {
    enumerable: true,
    get() {
      return networkMode;
    },
    set(value?: typeof networkMode) {
      networkMode = value;
      if (value === undefined || value === "none") {
        return;
      }
      delete s.hostname;
      assert(Object.keys(s.networks).length === 0,
        "cannot set ComposeService.network_mode with non-empty ComposeService.networks");
      for (const key of Object.keys(s.sysctls)) {
        if (key.startsWith("net.")) {
          delete s.sysctls[key]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
        }
      }
    },
  });

  return s;
}

/**
 * Get service annotation.
 * @param s - Compose service instance.
 * @param key - Annotation name.
 *
 * @see `docs/annotate.md` has a list of annotations used in the codebase.
 */
export function annotate(s: ReadonlyDeep<ComposeService>, key: string): string | undefined;

/**
 * Set service annotation.
 * @param s - Compose service instance.
 * @param key - Annotation name.
 * @param value - Annotation value.
 */
export function annotate(s: ComposeService, key: string, value: string | number): ComposeService;

export function annotate(s: any, key: string, value?: string | number) {
  key = `${annotate.PREFIX}${key}`;
  if (value === undefined) {
    return s.annotations?.[key];
  }

  s.annotations ??= {};
  s.annotations[key] = `${value}`;
  return s;
}

export namespace annotate {
  export const PREFIX = "5gdeploy.";
}

/**
 * List containers that match the network function name.
 * @param c - Compose file, possibly readonly.
 * @param nf - Desired network function name.
 */
export function listByNf<T extends Pick<ReadonlyDeep<ComposeService>, "container_name">>(
    c: { readonly services: Record<string, T> }, nf: string,
): Iterable<T> {
  return filter(Object.values(c.services), ({ container_name }) => nameToNf(container_name) === nf);
}

/**
 * List services whose annotation matching a predicate.
 * @param c - Compose file, possibly readonly.
 * @param key - Annotation key.
 * @param predicate - Expected value or predicate function.
 * @returns List of matched services.
 */
export function listByAnnotation<T extends Pick<ReadonlyDeep<ComposeService>, "annotations">>(
    c: { readonly services: Record<string, T> }, key: string,
    predicate: string | number | ((value: string) => boolean) = () => true,
): T[] {
  key = `${annotate.PREFIX}${key}`;
  if (typeof predicate !== "function") {
    const expected = `${predicate}`;
    predicate = (v) => v === expected;
  }

  return Object.values(c.services).filter((s) => {
    const value = s.annotations?.[key];
    return value !== undefined && predicate(value);
  });
}

/** Derive MAC address from IPv4 address. */
export function ip2mac(ip: number | string): string {
  if (typeof ip === "string") {
    ip = ip2long(ip);
  }
  return `52:de${hexPad(ip, 8).replaceAll(/([\da-f]{2})/gi, ":$1").toLowerCase()}`;
}

/**
 * Add a netif to a service.
 * @returns IPv4 address assigned to the netif.
 */
export function connectNetif(c: ComposeFile, ct: string, net: string, ip: string): string {
  const s = c.services[ct];
  assert(s, `service ${ct} missing`);
  const network = c.networks[net];
  assert(network, `network ${net} missing`);
  const subnet = new Netmask(network.ipam.config[0]?.subnet ?? "255.255.255.255/32");
  const addr = new Netmask(`${ip}/32`);
  assert(subnet.contains(addr), `network ${net} subnet ${subnet} does not contain IP ${ip}`);
  delete s.network_mode;
  s.networks[net] = {
    mac_address: ip2mac(addr.netLong),
    ipv4_address: addr.base,
    driver_opts: {
      "com.docker.network.endpoint.ifname": net,
    },
  };
  annotate(s, `ip_${net}`, ip);
  return ip;
}

/**
 * Remove a netif from a service.
 * @returns IPv4 address previously assigned to the netif.
 */
export function disconnectNetif(c: ComposeFile, ct: string, net: string): string {
  const s = c.services[ct];
  assert(s, `service ${ct} missing`);
  const netif = s.networks[net];
  assert(netif, `netif ${ct}:${net} missing`);
  delete s.networks[net]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
  if (Object.keys(s.networks).length === 0) {
    s.network_mode = "none";
  }
  return netif.ipv4_address;
}

function getIPImpl([c, ct, net = ct]: getIP.Args): { s: ReadonlyDeep<ComposeService>; net: string; ip: string } {
  let s: ReadonlyDeep<ComposeService> | undefined;
  if ("services" in c) {
    if (ct.endsWith("*")) {
      const nf = ct.slice(0, -1);
      [s] = take(listByNf(c, nf), 1);
    } else {
      s = c.services[ct];
    }
    assert(s, `service ${ct} missing`);
  } else {
    s = c;
  }

  const ip = annotate(s, `ip_${net}`);
  assert(ip, `netif ${s.container_name}:${net} missing`);
  return { s, net, ip };
}

/**
 * Retrieve IPv4 address.
 * @param args - `service, ct` or `ComposeFile, ct, net`
 * @returns IPv4 address.
 * @throws Error - Netif does not exist.
 */
export function getIP(...args: getIP.Args): string {
  return getIPImpl(args).ip;
}
export namespace getIP {
  export type Args = [c: ReadonlyDeep<ComposeFile>, ct: string, net: string] | [s: ReadonlyDeep<ComposeService>, net: string];
}

/**
 * Retrieve IPv4 and MAC address.
 * @param args - `service, ct` or `ComposeFile, ct, net`
 * @throws Error - Netif does not exist.
 */
export function getIPMAC(...args: getIP.Args): [ip: string, mac: string] {
  const { s, net, ip } = getIPImpl(args);
  const mac = annotate(s, `mac_${net}`) ?? ip2mac(ip);
  return [ip, mac];
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
