import { sortBy } from "sort-by-typescript";
import assert from "tiny-invariant";

import type { PH } from "../types/mod.js";

/** Open5GCore network function configuration. */
export class NetworkFunction {
  /** Parse network function JSON document. */
  public static parse(body: string): NetworkFunction {
    const nf = new NetworkFunction();
    nf.Phoenix = JSON.parse(body).Phoenix;
    assert(nf.Phoenix?.Platform);
    assert(Array.isArray(nf.Phoenix.Module));
    nf.Phoenix.Module.sort(sortBy("binaryFile"));
    return nf;
  }

  public Phoenix: PH.Phoenix = {
    Platform: {},
    Module: [],
  };

  /**
   * Edit a module.
   * @param binaryName - Module binary name without path or .so suffix.
   * @param edit - Edit function.
   */
  public editModule<K extends keyof PH.ModuleConfigMap>(binaryName: K, edit: (m: PH.Module<PH.ModuleConfigMap[K]>) => void): void;

  /**
   * Edit a module, skip if module does not exist.
   * @param binaryName - Module binary name without path or .so suffix.
   * @param edit - Edit function.
   */
  public editModule<K extends keyof PH.ModuleConfigMap>(binaryName: K, optional: true, edit: (m: PH.Module<PH.ModuleConfigMap[K]>) => void): void;

  public editModule(binaryName: string, arg2: any, arg3?: any): void {
    const [optional, edit] = arg2 === true ? [true, arg3] : [false, arg2];

    const m = this.Phoenix.Module.find((m) => m.binaryFile.endsWith(`/${binaryName}.so`));
    if (m === undefined) {
      if (optional) {
        return;
      }
      throw new Error(`module ${binaryName} not found`);
    }

    edit(m);
  }

  /** Save as JSON. */
  public save(): unknown {
    return { Phoenix: this.Phoenix };
  }
}
