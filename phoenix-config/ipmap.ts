import assert from "minimalistic-assert";
import DefaultMap from "mnemonist/default-map.js";
import { Netmask } from "netmask";

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

  /** Format ct_net_IP environment variable name. */
  export function formatEnv(ct: string, net: string, prefix = "%"): string {
    return `${prefix}${ct.toUpperCase()}_${net.toUpperCase()}_IP`;
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
      assert(toNf(ct) === nf);
      m.set(ct, item);
    }
    return m;
  }
}
