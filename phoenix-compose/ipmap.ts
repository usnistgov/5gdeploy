import DefaultMap from "mnemonist/default-map.js";
import { Netmask } from "netmask";

/** ph_init ip-map record. */
export interface Record {
  ct: string;
  net: string;
  ip: string;
  cidr: number;
}

/** Parse ph_init ip-map file. */
export function parse(body: string): Record[] {
  const records: Record[] = [];
  for (let line of body.split("\n")) {
    line = line.trim();
    let tokens: [string, string, string, string | number];
    if (line.startsWith("#") || (tokens = line.split(/\s+/) as any).length !== 4) {
      continue;
    }
    let [ct, net, ip, cidr] = tokens;
    cidr = Number.parseInt(cidr as string, 10);
    if (ip === "0.0.0.0" || cidr === 32) {
      continue;
    }
    records.push({ ct, net, ip, cidr });
  }
  return records;
}

/**
 * List networks defined in ip-map.
 * @returns network=>subnet
 */
export function listNetworks(records: readonly Record[]): ReadonlyMap<string, Netmask> {
  const networks = new Map<string, Netmask>();
  for (const { net, ip, cidr } of records) {
    networks.set(net, new Netmask(`${ip}/${cidr}`));
  }
  return networks;
}

/**
 * List containers defined in ip-map.
 * @returns container=>network=>ip
 */
export function listContainers(records: readonly Record[]): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const containers = new DefaultMap<string, Map<string, string>>((k) => new Map<string, string>());
  for (const { ct, net, ip } of records) {
    containers.get(ct).set(net, ip);
  }
  return containers;
}

/** Derive network function name from container name. */
export function toNf(ct: string): string {
  return ct.replace(/(_.*|\d*)$/, "");
}
