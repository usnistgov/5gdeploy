import stringify from "json-stable-stringify";
import assert from "minimalistic-assert";

import type * as PH from "../types/phoenix.js";

/** Open5GCore network function configuration. */
export class NetworkFunctionConfig {
  public Phoenix: PH.NetworkFunction["Phoenix"] = {
    Platform: {},
    Module: [],
  };

  /** Retrieve module by module binary name (without path or .so prefix). */
  public getModule<K extends keyof PH.ModuleConfigMap>(binaryName: K): PH.Module<PH.ModuleConfigMap[K]>;
  public getModule(binaryName: string): PH.Module;
  public getModule(binaryName: string): any {
    const m = this.Phoenix.Module.find((m) => m.binaryFile.endsWith(`/${binaryName}.so`));
    if (m === undefined) {
      throw new Error(`module ${binaryName} not found`);
    }
    return m;
  }

  /** Save as network function JSON. */
  public save(): string {
    return stringify({ Phoenix: this.Phoenix }, { space: 2 });
  }
}
export namespace NetworkFunctionConfig {
  /** Parse network function JSON document. */
  export function parse(body: string): NetworkFunctionConfig {
    const cfg = new NetworkFunctionConfig();
    cfg.Phoenix = JSON.parse(body).Phoenix;
    assert(!!cfg.Phoenix);
    assert(cfg.Phoenix.Platform);
    assert(Array.isArray(cfg.Phoenix.Module));
    return cfg;
  }
}
