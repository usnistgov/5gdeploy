import stringify from "json-stringify-deterministic";
import { ip2long, Netmask } from "netmask";
import { filter, take } from "obliterator";
import type { ConditionalKeys, ReadonlyDeep, UnknownRecord } from "type-fest";

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
  return (c.services[name] ??= createService(name, image));
}

function createService(name: string, image: string): ComposeService {
  const s: ComposeService = {
    container_name: name,
    hostname: name,
    image: image,
    init: true,
    stop_signal: "SIGTERM",
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
    extra_hosts: {},
    depends_on: {},
  };

  for (const key of [
    "sysctls", "environment", "networks", "extra_hosts", "depends_on",
  ] as const satisfies ReadonlyArray<ConditionalKeys<ComposeService, UnknownRecord>>) {
    Object.defineProperty(s, key, {
      enumerable: true,
      writable: false,
      value: s[key],
    });
  }

  for (const [key, uniqBy] of [
    ["cap_add", (cap: string) => cap],
    ["devices", (device: string) => device.split(":")[1]!],
    ["volumes", (vol: ComposeVolume) => vol.target],
    ["ports", (port: ComposePort) => `${port.target}/${port.protocol}`],
  ] as ReadonlyArray<[
      key: ConditionalKeys<ComposeService, unknown[]>,
      uniqBy: (value: any) => string,
  ]>) {
    Object.defineProperty(s, key, {
      enumerable: true,
      writable: false,
      value: s[key],
    });

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
  key = `5gdeploy.${key}`;
  if (value === undefined) {
    return s.annotations?.[key];
  }

  s.annotations ??= {};
  s.annotations[key] = `${value}`;
  return s;
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
  s.networks[net] = {
    mac_address: ip2mac(addr.netLong),
    ipv4_address: addr.base,
  };
  annotate(s, `ip_${net}`, ip);
  return ip;
}

/**
 * Remove a netif from a service.
 * @returns IPv4 address previously assigned to the netif.
 */
export function disconnectNetif(c: ComposeFile, ct: string, net: string): string {
  const service = c.services[ct];
  assert(service, `service ${ct} missing`);
  const netif = service.networks[net];
  assert(netif, `netif ${ct}:${net} missing`);
  delete service.networks[net]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
  return netif.ipv4_address;
}

/**
 * Retrieve IPv4 address.
 * @param ct - Either container name or network function named followed by "*".
 * @throws Error - Service or netif does not exist.
 */
export function getIP(c: ReadonlyDeep<ComposeFile>, ct: string, net: string): string;

/**
 * Retrieve IPv4 address.
 * @throws Error - Netif does not exist.
 */
export function getIP(s: ReadonlyDeep<ComposeService>, net: string): string;

export function getIP(c: ReadonlyDeep<ComposeFile> | ReadonlyDeep<ComposeService>, ct: string, net = ct): string {
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
  return ip;
}

/**
 * Retrieve IPv4 and MAC address.
 * @throws Error - Netif does not exist.
 */
export function getIPMAC(s: ReadonlyDeep<ComposeService>, net: string): [ip: string, mac: string] {
  const ip = getIP(s, net);
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
