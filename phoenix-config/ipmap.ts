import assert from "minimalistic-assert";
import DefaultMap from "mnemonist/default-map.js";
import set from "mnemonist/set.js";
import { ip2long, long2ip, Netmask } from "netmask";

import { type ComposeFile } from "../types/compose.js";

/** Content of ph_init ip-map file. */
export class IPMAP {
  /**
   * Parse ip-map file.
   * @param body ip-map file content.
   * @param rejectEnv convert rejected records as ct_net_IP=ip environs.
   */
  public static parse(body: string, rejectEnv?: Map<string, string>): IPMAP {
    const networks = new Map<string, Netmask>();
    const containers = new DefaultMap<string, Map<string, string>>(() => new Map());
    for (let line of body.split("\n")) {
      line = line.trim();
      let tokens: [string, string, string, string];
      if (line.startsWith("#") || (tokens = line.split(/\s+/) as any).length !== 4) {
        continue;
      }
      const [ct, net, ip, cidrS] = tokens;
      const cidr = Number.parseInt(cidrS, 10);
      if (ip === "0.0.0.0" || !(cidr >= 8 && cidr < 32)) {
        rejectEnv?.set(`${ct.toUpperCase()}_${net.toUpperCase()}_IP`, ip);
        continue;
      }
      networks.set(net, new Netmask(ip, cidr));
      containers.get(ct).set(net, ip);
    }
    return new IPMAP(networks, new Map(containers));
  }

  /** Convert from Compose file. */
  public static fromCompose(c: ComposeFile): IPMAP {
    const networks = new Map<string, Netmask>();
    const containers = new Map<string, Map<string, string>>();
    for (const [net, { ipam: { config: [ipam0] } }] of Object.entries(c.networks)) {
      assert(ipam0?.subnet, `missing .networks.${net}.ipam.config[0].subnet`);
      networks.set(net, new Netmask(ipam0.subnet));
    }
    for (const [ct, { networks }] of Object.entries(c.services)) {
      const netifs = new Map<string, string>();
      for (const [net, { ipv4_address }] of Object.entries(networks)) {
        netifs.set(net, ipv4_address);
      }
      containers.set(ct, netifs);
    }
    return new IPMAP(networks, containers);
  }

  private constructor(
      private readonly networks_: Map<string, Netmask>,
      private readonly containers_: Map<string, Map<string, string>>,
  ) {}

  /**
   * List networks.
   * Each key is a network name.
   * Each value is a subnet of the network.
   */
  public get networks(): ReadonlyMap<string, Netmask> {
    return this.networks_;
  }

  /**
   * List containers.
   * Each key is a container name.
   * Each value is a map whose key is network name and value is IP address in the network.
   */
  public get containers(): ReadonlyMap<string, ReadonlyMap<string, string>> {
    return this.containers_;
  }

  /** List container names by network function. */
  public *listContainersByNf(nf: string): Iterable<string> {
    for (const ct of this.containers_.keys()) {
      if (IPMAP.toNf(ct) === nf) {
        yield ct;
      }
    }
  }

  /** Format ct_net_IP environment variable name, and ensure it exists. */
  public formatEnv(ct: string, net: string, prefix = "%"): string {
    const varName = IPMAP.formatEnv(ct, net, prefix);
    assert(this.containers_.has(ct) && this.networks_.has(net), `${varName} undefined`);
    return varName;
  }

  /** Resolve ct_net_IP environment variable. */
  public resolveEnv(env: string): string | undefined {
    let tokens: string[];
    if ((tokens = env.toLowerCase().split("_")).length < 3 || tokens.at(-1) !== "ip") {
      return undefined;
    }
    const net = tokens.at(-2)!;
    const ct = tokens.slice(0, -2).join("_");
    return this.containers_.get(ct)?.get(net);
  }

  /**
   * Scale network function containers to specified quantity.
   * @param names wanted container names, must refer to same network function.
   * @param netifs network interfaces of each container.
   * @returns added, reused, and removed container names.
   */
  public scaleContainers(names: readonly string[], netifs: readonly string[]): Record<"added" | "reused" | "removed", Set<string>> {
    const added = new Set<string>();
    const reused = new Set<string>();
    const removed = new Set<string>();

    assert(names.length > 0);
    let nf: string | undefined;
    const wantNetifs = new Set(netifs);

    const readd: string[] = [];
    for (const ct of names) {
      nf ||= IPMAP.toNf(ct);
      assert(nf === IPMAP.toNf(ct));
      const ctNets = this.containers_.get(ct);
      if (ctNets) {
        const ctNetifs = new Set(ctNets.keys());
        if (set.isSuperset(ctNetifs, wantNetifs)) {
          for (const netif of set.difference(ctNetifs, wantNetifs)) {
            ctNets.delete(netif);
          }
        } else {
          readd.push(ct);
        }
        reused.add(ct);
      } else {
        this.addContainer(ct, netifs);
        added.add(ct);
      }
    }

    for (const ct of this.listContainersByNf(nf!)) {
      if (!added.has(ct) && !reused.has(ct)) {
        this.removeContainer(ct);
        removed.add(ct);
      }
    }

    for (const ct of readd) {
      this.removeContainer(ct);
      this.addContainer(ct, netifs);
    }

    return { added, reused, removed };
  }

  private suggestIPLastOctet(nf: string): number | undefined {
    let hint = 1;
    for (const [ct, nets] of this.containers_) {
      if (IPMAP.toNf(ct) === nf) {
        for (const ip of nets.values()) { // eslint-disable-line no-unreachable-loop
          hint = ip2long(ip) & 0xFF;
          break;
        }
        break;
      }
    }

    const used = new Set<number>();
    used.add(1);
    for (const nets of this.containers_.values()) {
      for (const ip of nets.values()) {
        used.add(ip2long(ip) & 0xFF);
      }
    }

    const assignBetween = (min: number, max: number): number | undefined => {
      for (let octet = min; octet < max; ++octet) {
        if (!used.has(octet)) {
          return octet;
        }
      }
      return undefined;
    };

    return assignBetween(hint + 1, 254) ?? assignBetween(2, hint - 1);
  }

  /**
   * Add a container.
   * @param name container name.
   * @param netifs connected network interfaces.
   *
   * When possible, the new container will be assigned IP addresses adjacent to existing containers
   * of the same network function.
   */
  public addContainer(name: string, netifs: readonly string[]): void {
    assert(!this.containers_.has(name));
    const lastOctet = this.suggestIPLastOctet(IPMAP.toNf(name));
    if (lastOctet === undefined) {
      throw new Error("IP subnet full");
    }

    const nets = new Map<string, string>();
    for (const netif of netifs) {
      const net = this.networks_.get(netif);
      assert(!!net);
      assert(net.bitmask <= 24);
      nets.set(netif, long2ip(net.netLong + lastOctet));
    }
    this.containers_.set(name, nets);
  }

  /** Remove a container. */
  public removeContainer(name: string): void {
    this.containers_.delete(name);
  }

  /** Save ip-map file. */
  public save(): string {
    const lines: string[] = [];
    for (const [ct, netifs] of this.containers_) {
      for (const [net, ip] of netifs) {
        const { bitmask } = this.networks_.get(net)!;
        lines.push(`${ct} ${net} ${ip} ${bitmask}\n`);
      }
    }
    return lines.join("");
  }
}
export namespace IPMAP {
  /** Derive network function name from container name. */
  export function toNf(ct: string): string {
    return ct.replace(/(_.*|\d*)$/, "");
  }

  export function formatEnv(ct: string, net: string, prefix = "%"): string {
    return `${prefix}${ct.toUpperCase()}_${net.toUpperCase()}_IP`;
  }

  export function suggestNames<T>(nf: string, list: readonly T[]): Map<string, T> {
    const m = new Map<string, T>();
    for (const [i, item] of list.entries()) {
      let ct = (item as any).name as string;
      if (typeof ct !== "string") {
        ct = `${nf}${i}`;
      }
      assert(toNf(ct) === nf);

      m.set(ct, item);
    }
    return m;
  }

}
