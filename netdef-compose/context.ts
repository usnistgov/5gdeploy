import type { Promisable } from "type-fest";

import * as compose from "../compose/mod.js";
import type { NetDef } from "../netdef/netdef.js";
import type { ComposeFile } from "../types/mod.js";

/** Contextual information and helpers while converting NetDef into Compose context. */
export class NetDefComposeContext extends compose.ComposeContext {
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
      out: string,
      ipAlloc: compose.IPAlloc,
  ) {
    super(out, ipAlloc);
  }

  /** Access NetDef JSON. */
  public get network() {
    return this.netdef.network;
  }

  /** Final steps. */
  public readonly finalize: Array<() => Promisable<void>> = [];
}
