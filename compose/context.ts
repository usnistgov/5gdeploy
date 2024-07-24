import path from "node:path";

import type { ComposeFile, ComposeService } from "../types/mod.js";
import { file_io } from "../util/mod.js";
import * as compose from "./compose.js";
import type { IPAlloc } from "./ipalloc.js";

/** Compose context output folder. */
export class ComposeContext {
  /** Output Compose file. */
  public readonly c: ComposeFile = compose.create();

  /**
   * Constructor.
   * @param out - Output folder.
   * @param ipAlloc - IP address allocator.
   */
  constructor(
      public readonly out: string,
      public readonly ipAlloc: IPAlloc,
  ) {}

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
      const ip = compose.annotate(s, `ip_${net}`) ?? s.networks[net]?.ipv4_address;
      if (ip) {
        list.push(ip);
      }
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
      mountAsVolume?: ComposeContext.FileVolumeOptions,
  ): Promise<ComposeContext.WriteFileResult> {
    await file_io.write(path.resolve(this.out, filename), body);

    const result: ComposeContext.WriteFileResult = {
      mountInto({ s, target }) {
        s.volumes.push({
          type: "bind",
          source: path.join(".", filename),
          target,
          read_only: true,
        });
      },
    };

    if (mountAsVolume) {
      result.mountInto(mountAsVolume);
    }

    return result;
  }
}
export namespace ComposeContext {
  /** Options to mount file as volume. */
  export interface FileVolumeOptions {
    /** Add a bind mount to the container. */
    s: ComposeService;
    /** Target of the bind mount within the container filesystem. */
    target: string;
  }

  /** {@link ComposeContext.writeFile} result. */
  export interface WriteFileResult {
    mountInto: (opts: FileVolumeOptions) => void;
  }
}
