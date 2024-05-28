import DefaultMap from "mnemonist/default-map.js";
import { Netmask } from "netmask";
import assert from "tiny-invariant";

import type { ComposeFile } from "../types/mod.js";

/** Content of ph_init `ip-map` file. */
export class IPMAP {
  /**
   * Parse `ip-map` file.
   * @param body - `ip-map` file content.
   * @param rejectEnv - If specified, it will be populated with rejected records
   * as `ct_net_IP=ip` environs.
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
   *
   * @remarks
   * Each key is a network name.
   * Each value is a subnet of the network.
   */
  public get networks(): ReadonlyMap<string, Netmask> {
    return this.networks_;
  }

  /**
   * List containers.
   *
   * @remarks
   * Each key is a container name.
   * Each value is a map whose key is network name and value is IP address in the network.
   */
  public get containers(): ReadonlyMap<string, ReadonlyMap<string, string>> {
    return this.containers_;
  }

  /** Save `ip-map` file. */
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
  /** Format `ct_net_IP` environment variable name. */
  export function formatEnv(ct: string, net: string, prefix = "%"): string {
    return `${prefix}${ct.toUpperCase()}_${net.toUpperCase()}_IP`;
  }
}
