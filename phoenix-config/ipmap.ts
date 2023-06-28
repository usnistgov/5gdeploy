import assert from "minimalistic-assert";
import DefaultMap from "mnemonist/default-map.js";
import { ip2long, long2ip, Netmask } from "netmask";

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
      ipmap.networks_.set(net, new Netmask(ip, cidr));
      ipmap.containers_.get(ct).set(net, ip);
    }
    return ipmap;
  }

  private readonly networks_ = new Map<string, Netmask>();
  private readonly containers_ = new DefaultMap<string, Map<string, string>>(() => new Map());

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

  /**
   * Suggest unused sequential container name.
   * @param nf network function name.
   */
  public suggestContainerName(nf: string): string {
    assert.equal(nf, IPMAP.toNf(nf));
    for (let i = 1; ; ++i) {
      const name = `${nf}${i}`;
      if (!this.containers_.has(name)) {
        return name;
      }
    }
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
  public addContainer(name: string, netifs: string[]): void {
    assert(!this.containers_.has(name));
    const lastOctet = this.suggestIPLastOctet(IPMAP.toNf(name));
    if (lastOctet === undefined) {
      throw new Error("IP subnet full");
    }

    for (const netif of netifs) {
      const net = this.networks_.get(netif);
      assert(!!net);
      assert(net.bitmask <= 24);
      this.containers_.get(name).set(netif, long2ip(net.netLong + lastOctet));
    }
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
}
