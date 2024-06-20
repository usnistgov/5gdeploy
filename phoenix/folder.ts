import fs from "node:fs/promises";
import path from "node:path";

import type { AnyIterable } from "streaming-iterables";
import assert from "tiny-invariant";
import type { Promisable } from "type-fest";

import * as compose from "../compose/mod.js";
import { file_io } from "../util/mod.js";
import { NetworkFunction } from "./nf.js";

/** ph_init scenario folder. */
export class ScenarioFolder {
  private files = new Map<string, FileAction>();

  /** Create a file from an external file. */
  public createFrom(dst: string, src: string): void {
    this.files.set(dst, new FileAction(src));
  }

  /** Edit a file. */
  public edit(file: string, f: ScenarioFolder.EditFunc): void {
    const fa = this.files.get(file);
    assert(fa, "file not found");
    fa.edits.push(f);
  }

  /** Edit a network function JSON file. */
  public editNetworkFunction(ct: string, ...edits: ReadonlyArray<(c: NetworkFunction) => Promisable<void>>): void {
    this.edit(`${ct}.json`, async (body) => {
      const c = NetworkFunction.parse(body);
      for (const edit of edits) {
        await edit(c);
      }
      return c.save();
    });
  }

  /** Append SQL statements to a database. */
  public appendSQL(db: string, g: () => AnyIterable<string>): void {
    this.edit(`sql/${db}.sql`, (body) => compose.mysql.join(body, g()));
  }

  /**
   * Save to directory, applying pending edits.
   * @param cfg - Output configuration directory.
   * @param sql - Output SQL script directory.
   */
  public async save(cfg: string, sql: string): Promise<void> {
    await fs.rm(cfg, { recursive: true, force: true });
    await fs.rm(sql, { recursive: true, force: true });

    for (const [dst, fa] of this.files) {
      const dstPath = dst.startsWith("sql/") ? path.resolve(sql, dst.slice(4)) : path.resolve(cfg, dst);
      await file_io.write(dstPath, fa);
    }
  }
}
export namespace ScenarioFolder {
  export type EditFunc = (body: string) => Promisable<string>;
}

class FileAction implements file_io.write.Saver {
  constructor(
      public readonly readFromFile?: string,
      public readonly initialContent = "",
  ) {}

  public readonly edits: ScenarioFolder.EditFunc[] = [];

  public async save(): Promise<unknown> {
    if (this.readFromFile && this.edits.length === 0) {
      return file_io.write.copyFrom(this.readFromFile);
    }

    let body = this.readFromFile ? await file_io.readText(this.readFromFile) : this.initialContent;
    for (const edit of this.edits) {
      body = await edit(body);
    }
    return body;
  }
}
