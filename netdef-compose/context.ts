import fs from "node:fs/promises";
import path from "node:path";

import * as compose from "../compose/mod.js";
import type { NetDef } from "../netdef/netdef.js";
import { IPMAP } from "../phoenix-config/mod.js";
import { type ComposeFile, type ComposeService } from "../types/compose.js";
import { env } from "./env.js";
import { IPAlloc } from "./ipalloc.js";

export class NetDefComposeContext {
  public readonly c: ComposeFile = compose.create();

  private readonly ipAlloc = new IPAlloc(env.D5G_IP_SPACE);

  constructor(public readonly netdef: NetDef, public readonly out: string) {}

  public get network() {
    return this.netdef.network;
  }

  public defineNetwork(net: string, wantNAT = false): void {
    const subnet = this.ipAlloc.allocNetwork(net);
    compose.defineNetwork(this.c, net, subnet, wantNAT);
  }

  public defineService(ct: string, image: string, nets: readonly string[]): ComposeService {
    const service = compose.defineService(this.c, ct, image);
    for (const net of nets) {
      compose.connectNetif(this.c, ct, net, this.ipAlloc.allocNetif(net, ct));
    }
    return service;
  }

  /** Gather IP addresses of a network function or containers on a network. */
  public gatherIPs(nf: string | string[], net: string): string[] {
    const list: string[] = [];
    for (const [ct, s] of Object.entries(this.c.services)) {
      if ((typeof nf === "string") ? (IPMAP.toNf(ct) !== nf) : (!nf.includes(ct))) {
        continue;
      }
      const netif = s.networks[net];
      if (!netif) {
        continue;
      }
      list.push(netif.ipv4_address);
    }
    return list;
  }

  public async writeFile(filename: string, body: string | Uint8Array): Promise<void> {
    filename = path.resolve(this.out, filename);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, body);
  }
}
