import assert from "minimalistic-assert";
import BiMap from "mnemonist/bi-map.js";
import { ip2long, long2ip, Netmask } from "netmask";

import type { YargsInfer, YargsOptions } from "../util/mod.js";

/** Yargs options definition for IPv4 address allocator. */
export const ipAllocOptions = {
  "ip-space": {
    coerce(arg): Netmask {
      const subnet = new Netmask(arg);
      assert(subnet.bitmask <= 18, "/18 or larger address space required");
      return subnet;
    },
    desc: "Compose networks IP address space, /18 or larger",
    default: "172.25.192.0/18",
    type: "string",
  },
  "ip-fixed": {
    desc: "fixed IP address assignment",
    string: true,
    type: "array",
  },
} as const satisfies YargsOptions;

/** IPv4 address allocator. */
export class IPAlloc {
  constructor({
    "ip-space": space,
    "ip-fixed": fixed = [],
  }: YargsInfer<typeof ipAllocOptions>) {
    this.nextNetwork.n = BigInt(space.netLong);
    this.nextNetwork.max = BigInt(ip2long(space.last));

    for (const line of fixed) {
      const m = /^(\w+),(\w+),([\d.]+)$/.exec(line);
      assert(!!m, `bad --ip-fixed=${line}`);
      const [, host, net, ipStr] = m as string[] as [string, string, string, string];
      const ip = BigInt(ip2long(ipStr));
      saveFixed("network", this.networks, net, ip & ~0xFFn);
      saveFixed("host", this.hosts, host, ip & 0xFFn);
    }
  }

  private readonly networks = new BiMap<string, bigint>();
  private nextNetwork = { n: -1n, step: 256n, max: -1n };
  private readonly hosts = BiMap.from<string, bigint>({ ".0": 0n, ".1": 1n });
  private nextHost = { n: 2n, step: 1n, max: 254n };

  /**
   * Allocate a subnet.
   * @param net - Subnet name.
   * @returns /24 subnet.
   */
  public allocNetwork(net: string): string {
    const c = allocOne("network", this.networks, this.nextNetwork, net);
    return `${long2ip(Number(c))}/24`;
  }

  /**
   * Find network by IP address.
   * @param ip - IPv4 address.
   * @returns Subnet name or undefined if unknown.
   */
  public findNetwork(ip: string): string | undefined {
    const c = BigInt(ip2long(ip)) & ~0xFFn;
    return this.networks.inverse.get(c);
  }

  /**
   * Allocate a netif address.
   * @param net - Subnet name. It must exist.
   * @param host - Host name.
   * @returns - IPv4 address within subnet.
   */
  public allocNetif(net: string, host: string): string {
    const c = this.networks.get(net);
    assert(c, "network does not exist");

    const d = allocOne("host", this.hosts, this.nextHost, host);
    return long2ip(Number(c | d));
  }
}

function saveFixed(kind: string, m: BiMap<string, bigint>, key: string, value: bigint): void {
  let conflictValue: bigint;
  if (m.has(key) && (conflictValue = m.get(key)!) !== value) {
    throw new Error(`${kind} "${key}" has conflicting assignment ${long2ip(Number(conflictValue))}`);
  }

  let conflictKey: string;
  if (m.inverse.has(value) && (conflictKey = m.inverse.get(value)!) !== key) {
    throw new Error(`${kind} ${long2ip(Number(value))} has conflicting assignment "${conflictKey}"`);
  }

  m.set(key, value);
}

function allocOne(kind: string, m: BiMap<string, bigint>, next: { n: bigint; step: bigint; max: bigint }, key: string): bigint {
  let v = m.get(key);
  if (v === undefined) {
    do {
      v = next.n;
      next.n += next.step;
      assert(v <= next.max, `too many ${kind}s`);
    } while (m.inverse.get(v) !== undefined);

    m.set(key, v);
  }
  return v;
}
