import DefaultMap from "mnemonist/default-map.js";
import { Netmask } from "netmask";

/** ph_init ip-map file. */
export class IPMAP {
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

  /** Save as ph_init ip-map file. */
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

  /** Parse content of ph_init ip-map file. */
  export function parse(body: string): IPMAP {
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
        continue;
      }
      ipmap.records.push({ ct, net, ip, cidr });
    }
    return ipmap;
  }

  /** Derive network function name from container name. */
  export function toNf(ct: string): string {
    return ct.replace(/(_.*|\d*)$/, "");
  }
}
