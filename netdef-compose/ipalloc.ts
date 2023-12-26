import assert from "minimalistic-assert";
import BiMap from "mnemonist/bi-map.js";
import { ip2long, long2ip, Netmask } from "netmask";
import type { InferredOptionTypes, Options as YargsOptions } from "yargs";

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
} as const satisfies Record<string, YargsOptions>;
type IPAllocOpts = InferredOptionTypes<typeof ipAllocOptions>;

/** IP address allocator. */
export class IPAlloc {
  constructor({
    "ip-space": space,
    "ip-fixed": fixed = [],
  }: IPAllocOpts) {
    this.nextNetwork.n = space.netLong;
    this.nextNetwork.max = ip2long(space.last);

    for (const line of fixed) {
      const m = /^(\w+),(\w+),([\d.]+)$/.exec(line);
      if (!m) {
        throw new Error(`bad --ip-fixed=${line}`);
      }
      const [, host, net, ipStr] = m as string[] as [string, string, string, string];
      const ip = ip2long(ipStr);
      saveFixed("network", this.networks, net, ip & ~0xFF);
      saveFixed("host", this.hosts, host, ip & 0xFF);
    }
  }

  private readonly networks = new BiMap<string, number>();
  private nextNetwork = { n: -1, step: 256, max: -1 };
  private readonly hosts = BiMap.from<string, number>({ ".0": 0, ".1": 1 });
  private nextHost = { n: 2, step: 1, max: 254 };

  /**
   * Allocate a subnet.
   * @param net subnet name.
   * @returns /24 subnet.
   */
  public allocNetwork(net: string): string {
    const c = allocNumber("networks", this.networks, this.nextNetwork, net);
    return `${long2ip(c)}/24`;
  }

  /**
   * Allocate a netif address.
   * @param net subnet name, must exist.
   * @param host host name.
   * @returns address in subnet.
   */
  public allocNetif(net: string, host: string): string {
    const c = this.networks.get(net);
    assert(c, "network does not exist");
    const d = allocNumber("hosts", this.hosts, this.nextHost, host);
    return long2ip(c | d);
  }
}

function saveFixed(kind: string, m: BiMap<string, number>, key: string, value: number): void {
  if (m.has(key) && m.get(key) !== value) {
    throw new Error(`${kind} "${key}" has conflicting assignment`);
  }
  if (m.inverse.has(value) && m.inverse.get(value) !== key) {
    throw new Error(`${kind} ${long2ip(value)} has conflicting assignment`);
  }
  m.set(key, value);
}

function allocNumber(kind: string, m: BiMap<string, number>, next: { n: number; step: number; max: number }, key: string): number {
  let v = m.get(key);
  if (v === undefined) {
    do {
      v = next.n;
      next.n += next.step;
      assert(v <= next.max, `too many ${kind}`);
    } while (m.inverse.get(v) !== undefined);
    m.set(key, v);
  }
  return v;
}
