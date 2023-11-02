import assert from "minimalistic-assert";
import { long2ip, Netmask } from "netmask";

/** IP address allocator. */
export class IPAlloc {
  /**
   * Constructor.
   * @param space overall address space, at least /18 subnet.
   */
  constructor(space: string) {
    const subnet = new Netmask(space);
    assert(subnet.bitmask <= 18, "/18 or larger address space required");
    this.space = subnet;
  }

  private readonly space: Netmask;
  private readonly networks: string[] = [];
  private readonly hosts: string[] = [".0", ".1"];

  /**
   * Allocate a subnet.
   * @param net subnet name.
   * @returns /24 subnet.
   */
  public allocNetwork(net: string): string {
    let c = this.networks.indexOf(net);
    if (c < 0) {
      assert(this.networks.length < 2 ** (32 - this.space.bitmask), "too many networks");
      c = this.networks.push(net) - 1;
    }
    return `${long2ip(this.space.netLong + 256 * c)}/24`;
  }

  /**
   * Allocate a netif address.
   * @param net subnet name, must exist.
   * @param host host name.
   * @returns address in subnet.
   */
  public allocNetif(net: string, host: string): string {
    const c = this.networks.indexOf(net);
    assert(c >= 0, "network does not exist");
    let d = this.hosts.indexOf(host);
    if (d < 0) {
      assert(this.hosts.length < 254, "too many hosts");
      d = this.hosts.push(host) - 1;
    }
    return long2ip(this.space.netLong + 256 * c + d);
  }
}
