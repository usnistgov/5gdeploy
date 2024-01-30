import stringify from "json-stringify-deterministic";
import assert from "minimalistic-assert";

import type { PH } from "../types/mod.js";

/** Open5GCore network function configuration. */
export class NetworkFunction {
  /** Parse network function JSON document. */
  public static parse(body: string): NetworkFunction {
    const cfg = new NetworkFunction();
    cfg.Phoenix = JSON.parse(body).Phoenix;
    assert(!!cfg.Phoenix);
    assert(cfg.Phoenix.Platform);
    assert(Array.isArray(cfg.Phoenix.Module));
    return cfg;
  }

  public Phoenix: PH.Phoenix = {
    Platform: {},
    Module: [],
  };

  /** Retrieve module by module binary name (without path or .so prefix). */
  public getModule<K extends keyof PH.ModuleConfigMap>(binaryName: K): PH.Module<PH.ModuleConfigMap[K]>;
  public getModule<K extends keyof PH.ModuleConfigMap>(binaryName: K, optional: true): PH.Module<PH.ModuleConfigMap[K]> | undefined;
  public getModule(binaryName: string): PH.Module;
  public getModule(binaryName: string, optional: true): PH.Module | undefined;
  public getModule(binaryName: string, optional?: boolean): any {
    const m = this.Phoenix.Module.find((m) => m.binaryFile.endsWith(`/${binaryName}.so`));
    if (m === undefined && !optional) {
      throw new Error(`module ${binaryName} not found`);
    }
    return m;
  }

  /** Save as network function JSON. */
  public save(): string {
    return stringify({ Phoenix: this.Phoenix }, { space: "  " });
  }
}
