import { BiMap } from "mnemonist";
import { ip2long, long2ip, Netmask } from "netmask";

import { assert, YargsCoercedArray, type YargsInfer, type YargsOptions } from "../util/mod.js";

/** Yargs options definition for IPv4 address allocator. */
export function ipAllocOptions(dfltSpace = "172.25.192.0/18") {
  const minBitmask = new Netmask(dfltSpace).bitmask;
  return {
    "ip-space": {
      coerce(arg: string): Netmask {
        const subnet = new Netmask(arg);
        assert(subnet.bitmask <= minBitmask, `/${minBitmask} or larger address space required`);
        return subnet;
      },
      default: dfltSpace,
      desc: `Compose networks IP address space, /${minBitmask} or larger`,
      type: "string",
    },
    "ip-fixed": YargsCoercedArray({
      coerce(line): [net: string, host: string, ip: bigint] {
        const m = /^(\w+),(\w+),([\d.]+)$/.exec(line);
        assert(m, `bad --ip-fixed=${line}`);
        const [, host, net, ipStr] = m as string[] as [string, string, string, string];
        const ip = BigInt(ip2long(ipStr));
        return [net, host, ip];
      },
      desc: "fixed IP address assignment",
    }),
  } as const satisfies YargsOptions;
}

/** IPv4 address allocator. */
export class IPAlloc {
  constructor({
    "ip-space": space,
    "ip-fixed": fixed,
  }: YargsInfer<ReturnType<typeof ipAllocOptions>>) {
    this.nextNetwork.n = BigInt(space.netLong);
    this.nextNetwork.max = BigInt(ip2long(space.last));

    for (const [net, host, ip] of fixed) {
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
    const c = this.allocNetworkNumber(net);
    return `${long2ip(Number(c))}/24`;
  }

  private allocNetworkNumber(net: string): bigint {
    return allocOne("network", this.networks, this.nextNetwork, net, 1);
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
   * @param net - Subnet name.
   * @param host - Host name.
   * @returns IPv4 address within subnet.
   */
  public allocNetif(net: string, host: string, count = 1): string {
    const c = this.allocNetworkNumber(net);
    const d = allocOne("host", this.hosts, this.nextHost, host, count);
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

function allocOne(
    kind: string,
    m: BiMap<string, bigint>,
    next: { n: bigint; step: bigint; max: bigint },
    key: string,
    count: number,
): bigint {
  assert(count >= 1);

  let firstValue = m.get(key);
  let allValues: bigint[];
  const updateAllValues = () => {
    allValues = Array.from({ length: count }, (v, i) => {
      void v;
      return firstValue! + next.step * BigInt(i);
    });
  };
  const allUnused = (begin = 0) => allValues.every((value, i) => i < begin || !m.inverse.has(value));

  if (firstValue === undefined) {
    do {
      firstValue = next.n;
      next.n += next.step;
      updateAllValues();
      assert(allValues!.at(-1)! <= next.max, `too many ${kind}s`);
    } while (!allUnused());
  } else {
    updateAllValues();
    assert(allUnused(1), "some numbers are assigned elsewhere");
  }

  for (const [i, value] of allValues!.entries()) {
    m.set(i === 0 ? key : `${key}+${i}`, value);
  }

  return firstValue;
}
