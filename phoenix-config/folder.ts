import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import fsWalk from "@nodelib/fs.walk";
import DefaultMap from "mnemonist/default-map.js";
import { type AnyIterable, flatten } from "streaming-iterables";

import { IPMAP } from "./ipmap";
import { NetworkFunctionConfig } from "./nf";

const fsWalkPromise = promisify(fsWalk.walk);

/** ph_init scenario folder. */
export class ScenarioFolder {
  /**
   * Load from directory.
   * @param dir phoenix-src/cfg/*
   */
  public static async load(dir: string): Promise<ScenarioFolder> {
    return new ScenarioFolder(
      dir,
      (await fsWalkPromise(dir, {
        entryFilter(entry) {
          if (!entry.dirent.isFile()) {
            return false;
          }
          if (entry.path.includes("/sql/")) {
            return entry.name.endsWith(".sql");
          }
          return !entry.name.endsWith("-root");
        },
        deepFilter({ name }) {
          return name !== "prometheus";
        },
      })).map((entry) => path.relative(dir, entry.path)),
      IPMAP.parse(await fs.readFile(path.resolve(dir, "ip-map"), "utf8")),
    );
  }

  private constructor(
      private readonly dir: string,
      public readonly files: string[],
      public readonly ipmap: IPMAP,
  ) {}

  private readonly edits = new DefaultMap<string, ScenarioFolder.EditFunc[]>(() => []);

  /** Edit a file. */
  public edit(file: string, f: ScenarioFolder.EditFunc): void {
    this.edits.get(file).push(f);
  }

  /** Edit a network function .json file. */
  public editNetworkFunction(ct: string, f: (c: NetworkFunctionConfig) => void | Promise<void>): void {
    this.edit(`${ct}.json`, async (body) => {
      const c = NetworkFunctionConfig.parse(body);
      await f(c);
      return c.save();
    });
  }

  /** Append SQL statements to a database. */
  public appendSQL(db: string, g: () => AnyIterable<string | AnyIterable<string>>): void {
    this.edit(`sql/${db}.sql`, async (body) => {
      body += "\n";
      for await (const stmt of flatten(g())) {
        if (stmt.endsWith(";")) {
          body += `${stmt}\n`;
        } else {
          body += `${stmt};\n`;
        }
      }
      return body;
    });
  }

  /**
   * Save to directory, applying pending edits.
   * @param cfg configuration directory.
   * @param sql SQL script directory.
   */
  public async save(cfg: string, sql: string): Promise<void> {
    await fs.rm(cfg, { recursive: true, force: true });
    await fs.rm(sql, { recursive: true, force: true });
    const unusedEdits = new Set(this.edits.keys());
    for (const file of this.files) {
      const src = path.join(this.dir, file);
      const dst = file.startsWith("sql/") ? path.join(sql, file.slice(4)) : path.join(cfg, file);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      const edit = this.edits.peek(file);
      if (edit === undefined) {
        await fs.copyFile(src, dst);
      } else {
        let body = await fs.readFile(src, "utf8");
        for (const f of edit) {
          body = await f(body);
        }
        await fs.writeFile(dst, body);
        unusedEdits.delete(file);
      }
    }

    if (unusedEdits.size > 0) {
      throw new Error(`missing files for editing: ${Array.from(unusedEdits).join(",")}`);
    }
  }
}
export namespace ScenarioFolder {
  export type EditFunc = (body: string) => string | Promise<string>;
}
