import fs from "node:fs/promises";
import path from "node:path";

import yaml from "js-yaml";
import stringify from "json-stringify-deterministic";
import type { Promisable } from "type-fest";

import * as compose from "../compose/mod.js";
import type { NetDef } from "../netdef/netdef.js";
import type { ComposeFile, ComposeService } from "../types/compose.js";
import { type IPAlloc } from "./ipalloc.js";

export class NetDefComposeContext {
  public readonly c: ComposeFile = compose.create();

  constructor(
      public readonly netdef: NetDef,
      public readonly out: string,
      private readonly ipAlloc: IPAlloc,
  ) {}

  public get network() {
    return this.netdef.network;
  }

  /** Define a Compose network. */
  public defineNetwork(net: string, opts: compose.defineNetwork.Options = {}): void {
    const subnet = this.ipAlloc.allocNetwork(net);
    compose.defineNetwork(this.c, net, subnet, opts);
  }

  /**
   * Define a Compose service and connect to networks.
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

  /** Gather IP addresses of a network function or containers on a network. */
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
   * Write file to output folder.
   * @param filename relative filename within output folder.
   * @param body file contents.
   * @returns the filename with "./" prepended.
   *
   * If body has a .save() function, its return value is used as body.
   * Uint8Array and string are written directly.
   * All other types are encoded into JSON or YAML (when filename indicates YAML).
   */
  public async writeFile(filename: string, body: unknown, {
    executable = false, s, target,
  }: NetDefComposeContext.WriteFileOptions = {}): Promise<void> {
    if (s && target) {
      s.volumes.push({
        type: "bind",
        source: path.join(".", filename),
        target,
        read_only: true,
      });
    }

    while (typeof (body as Saver).save === "function") {
      body = await (body as Saver).save();
    }
    if (!(typeof body === "string" || body instanceof Uint8Array)) {
      if (filename.endsWith(".yaml") || filename.endsWith(".yml")) {
        body = yaml.dump(body, { forceQuotes: true, sortKeys: true });
      } else {
        body = stringify(body, { space: "  " });
      }
    }

    filename = path.resolve(this.out, filename);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, body as string | Uint8Array);
    if (executable) {
      await fs.chmod(filename, 0o755);
    }
  }
}
export namespace NetDefComposeContext {
  export interface WriteFileOptions {
    /** If true, make the file executable. */
    executable?: boolean;
    /** If specified, add a bind mount to the container. */
    s?: ComposeService;
    /** Target of the bind mount within the container filesystem. */
    target?: string;
  }
}

interface Saver {
  save(): Promisable<unknown>;
}
