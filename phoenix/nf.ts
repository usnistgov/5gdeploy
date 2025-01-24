import { sortBy } from "sort-by-typescript";

import type { PH } from "../types/mod.js";
import { assert, type file_io } from "../util/mod.js";

/** Open5GCore network function configuration. */
export class NetworkFunction implements file_io.write.Saver {
  /** Parse network function JSON document. */
  public static parse(body: string): NetworkFunction {
    const j = JSON.parse(body).Phoenix;
    assert(j?.Platform);
    assert(Array.isArray(j.Module));
    j.Module.sort(sortBy("binaryFile"));
    return new NetworkFunction(j);
  }

  private constructor(public Phoenix: PH.Phoenix) {}

  /**
   * Edit a module.
   * @param binaryName - Module binary name with neither path nor .so suffix.
   * @param edit - Edit function.
   */
  public editModule<K extends keyof PH.ModuleConfigMap, R = void>(binaryName: K, edit: (m: PH.Module<PH.ModuleConfigMap[K]>) => R): R;

  /**
   * Edit a module if it exists.
   * @param binaryName - Module binary name with neither path nor .so suffix.
   * @param edit - Edit function.
   */
  public editModule<K extends keyof PH.ModuleConfigMap, R = void>(binaryName: K, optional: true, edit: (m: PH.Module<PH.ModuleConfigMap[K]>) => R): R | void;

  public editModule(binaryName: keyof PH.ModuleConfigMap, arg2: any, arg3?: any) {
    const [optional, edit] = arg2 === true ? [true, arg3] : [false, arg2];

    const m = this.Phoenix.Module.find((m) => m.binaryFile.endsWith(`/${binaryName}.so`));
    if (m === undefined) {
      if (optional) {
        return;
      }
      throw new Error(`module ${binaryName} not found`);
    }

    return edit(m);
  }

  /** Save as JSON. */
  public save(): unknown {
    return { Phoenix: this.Phoenix };
  }
}
