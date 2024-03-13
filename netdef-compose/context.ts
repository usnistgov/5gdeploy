import path from "node:path";

import * as compose from "../compose/mod.js";
import type { NetDef } from "../netdef/netdef.js";
import type { ComposeFile, ComposeService } from "../types/mod.js";
import { file_io } from "../util/mod.js";
import type { IPAlloc } from "./ipalloc.js";

/** Contextual information and helpers while converting NetDef into Compose context. */
export class NetDefComposeContext {
  /** Output Compose file. */
  public readonly c: ComposeFile = compose.create();

  /**
   * Constructor.
   * @param netdef - Input NetDef.
   * @param out - Output folder.
   * @param ipAlloc - IP address allocator.
   */
  constructor(
      public readonly netdef: NetDef,
      public readonly out: string,
      public readonly ipAlloc: IPAlloc,
  ) {}

  /** Access NetDef JSON. */
  public get network() {
    return this.netdef.network;
  }

  /**
   * Define a Compose network.
   *
   * @remarks
   * Unlike networks implicitly defined in `.defineService()`, this allows setting network options.
   */
  public defineNetwork(net: string, opts: compose.defineNetwork.Options = {}): void {
    const subnet = this.ipAlloc.allocNetwork(net);
    compose.defineNetwork(this.c, net, subnet, opts);
  }

  /**
   * Define a Compose service and connect to networks.
   *
   * @remarks
   * Non-existent networks are implicitly defined with default settings.
   */
  public defineService(ct: string, image: string, nets: readonly string[]): ComposeService {
    const service = compose.defineService(this.c, ct, image);
    for (const net of nets) {
      this.defineNetwork(net);
      compose.connectNetif(this.c, ct, net, this.ipAlloc.allocNetif(net, ct));
    }
    return service;
  }

  /**
   * Gather IP addresses of a network function or containers on a network.
   * @param nf - A network function name or a list of container names.
   * @param net - Network name.
   * @returns A list of IPv4 addresses used by containers serving the network function.
   */
  public gatherIPs(nf: string | readonly string[], net: string): string[] {
    const list: string[] = [];
    for (const [ct, s] of Object.entries(this.c.services)) {
      if ((typeof nf === "string") ? (compose.nameToNf(ct) !== nf) : (!nf.includes(ct))) {
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

  /**
   * Write a file to output folder.
   * @param filename - Relative filename within output folder.
   * @param body - File contents.
   * @see {@link file_io.write}
   */
  public async writeFile(
      filename: string, body: unknown,
      { s, target }: NetDefComposeContext.WriteFileOptions = {},
  ): Promise<void> {
    if (s && target) {
      s.volumes.push({
        type: "bind",
        source: path.join(".", filename),
        target,
        read_only: true,
      });
    }

    await file_io.write(path.resolve(this.out, filename), body);
  }
}
export namespace NetDefComposeContext {
  /** {@link NetDefComposeContext.writeFile} options. */
  export interface WriteFileOptions {
    /** If specified, add a bind mount to the container. */
    s?: ComposeService;
    /** Target of the bind mount within the container filesystem. */
    target?: string;
  }
}
