import * as compose from "../compose/mod.js";
import type { NetDef } from "../netdef/netdef.js";
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
}
