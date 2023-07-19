import type { NetDef } from "../netdef/netdef.js";
import { type ComposeFile, type ComposeService } from "../types/compose.js";
import { env } from "./env.js";
import { IPAlloc } from "./ipalloc.js";

export class NetDefComposeContext {
  public readonly c: ComposeFile = {
    networks: {},
    services: {},
  };

  private readonly ipAlloc = new IPAlloc(env.D5G_IP_SPACE);

  constructor(public readonly netdef: NetDef, public readonly out: string) {}

  public get network() {
    return this.netdef.network;
  }

  public defineNetwork(net: string, wantNAT = false): void {
    const subnet = this.ipAlloc.allocNetwork(net);
    this.c.networks[net] = {
      name: `br-${net}`,
      driver_opts: {
        "com.docker.network.bridge.name": `br-${net}`,
        "com.docker.network.bridge.enable_ip_masquerade": Number(wantNAT),
      },
      ipam: {
        driver: "default",
        config: [{ subnet }],
      },
    };
  }

  public defineService(ct: string, image: string, nets: readonly string[]): ComposeService {
    const s: ComposeService = {
      container_name: ct,
      hostname: ct,
      image: image,
      init: true,
      cap_add: [],
      devices: [],
      sysctls: {},
      volumes: [],
      environment: {},
      networks: {},
    };
    for (const net of nets) {
      s.networks[net] = { ipv4_address: this.ipAlloc.allocNetif(net, ct) };
    }
    this.c.services[ct] = s;
    return s;
  }
}
