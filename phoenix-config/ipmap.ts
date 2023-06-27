import DefaultMap from "mnemonist/default-map.js";
import { Netmask } from "netmask";

/** Content of ph_init ip-map file. */
export class IPMAP {
  /**
   * Parse ip-map file.
   * @param body ip-map file content.
   * @param rejectEnv convert rejected records as ct_net_IP=ip environs.
   */
  public static parse(body: string, rejectEnv?: Map<string, string>): IPMAP {
    const ipmap = new IPMAP();
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
      ipmap.records.push({ ct, net, ip, cidr });
    }
    return ipmap;
  }

  /** Raw records. */
  public records: IPMAP.Record[] = [];

  /**
   * List networks.
   * Each key is a network name.
   * Each value is a subnet of the network.
   */
  public get networks(): ReadonlyMap<string, Netmask> {
    const networks = new Map<string, Netmask>();
    for (const { net, ip, cidr } of this.records) {
      networks.set(net, new Netmask(`${ip}/${cidr}`));
    }
    return networks;
  }

  /**
   * List containers.
   * Each key is a container name.
   * Each value is a map whose key is network name and value is IP address in the network.
   */
  public get containers(): ReadonlyMap<string, ReadonlyMap<string, string>> {
    const containers = new DefaultMap<string, Map<string, string>>(() => new Map<string, string>());
    for (const { ct, net, ip } of this.records) {
      containers.get(ct).set(net, ip);
    }
    return containers;
  }

  /**
   * Find containers by network function name.
   * @returns array of container names.
   */
  public findContainerByNf(nf: string): string[] {
    return Array.from(this.containers.keys()).filter((ct) => IPMAP.toNf(ct) === nf);
  }

  /** Save ip-map file. */
  public save(): string {
    return this.records.map(({ ct, net, ip, cidr }) => `${ct} ${net} ${ip} ${cidr}\n`).join("");
  }
}
export namespace IPMAP {
  export interface Record {
    ct: string;
    net: string;
    ip: string;
    cidr: number;
  }

  /** Derive network function name from container name. */
  export function toNf(ct: string): string {
    return ct.replace(/(_.*|\d*)$/, "");
  }
}
