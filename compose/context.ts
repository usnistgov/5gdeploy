import path from "node:path";

import type { EmptyObject, Promisable } from "type-fest";

import type { ComposeFile, ComposeService } from "../types/mod.js";
import { file_io } from "../util/mod.js";
import * as compose from "./compose.js";
import { makeComposeSh } from "./compose-sh.js";
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
   * @returns Subnet string in CIDR format.
   *
   * @remarks
   * Unlike networks implicitly defined in `.defineService()`, this allows setting network options.
   */
  public defineNetwork(net: string, opts: compose.defineNetwork.Options = {}): string {
    const subnet = this.ipAlloc.allocNetwork(net);
    compose.defineNetwork(this.c, net, subnet, opts);
    return subnet;
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
   * Write a file to output folder.
   * @param filename - Relative filename within output folder.
   * @param body - File contents.
   * @see {@link file_io.write}
   */
  public async writeFile(
      filename: string, body: unknown,
      opts: ComposeContext.WriteFileOptions = {},
  ): Promise<ComposeContext.WriteFileResult> {
    await file_io.write(path.resolve(this.out, filename), body, opts);

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

    if ("s" in opts) {
      result.mountInto(opts);
    }

    return result;
  }

  /** Final steps. */
  public readonly finalize: Array<() => Promisable<void>> = [];

  protected makeComposeSh(): Iterable<string> {
    return makeComposeSh(this.c);
  }

  /** Run final steps, save compose.yml and compose.sh. */
  public async finalSave(): Promise<void> {
    for (const op of this.finalize) {
      await op();
    }
    await this.writeFile("compose.yml", this.c);
    await this.writeFile("compose.sh", this.makeComposeSh());
  }
}
export namespace ComposeContext {
  export type WriteFileOptions = file_io.write.Options & (FileVolumeOptions | EmptyObject);

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
