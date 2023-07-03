import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import fsWalk from "@nodelib/fs.walk";
import * as envfile from "envfile";
import assert from "minimalistic-assert";
import DefaultMap from "mnemonist/default-map.js";
import { type AnyIterable, collect } from "streaming-iterables";

import { IPMAP } from "./ipmap.js";
import { NetworkFunctionConfig } from "./nf.js";

const fsWalkPromise = promisify(fsWalk.walk);

/** ph_init scenario folder. */
export class ScenarioFolder {
  /**
   * Load from directory.
   * @param dir phoenix-src/cfg/*
   */
  public static async load(dir: string): Promise<ScenarioFolder> {
    const files = new Set(await collect(scanFiles(dir)));
    const env = await parseEnv(await fs.readFile(path.resolve(dir, "env.sh"), "utf8"));
    const ipmap = IPMAP.parse(await fs.readFile(path.resolve(dir, "ip-map"), "utf8"), env);
    return new ScenarioFolder(dir, files, ipmap, env);
  }

  private constructor(
      private readonly dir: string,
      public readonly files: Set<string>,
      public readonly ipmap: IPMAP,
      public readonly env: Map<string, string>,
  ) {
    this.edit("ip-map", () => this.ipmap.save());

    this.edit("env.sh", () => {
      const obj: envfile.Input = {};
      for (const [k, v] of this.env) {
        obj[`export ${k}`] = v;
      }
      return envfile.stringify(obj);
    });
  }

  private readonly copies = new DefaultMap<string, string[]>(() => []);
  private readonly edits = new DefaultMap<string, ScenarioFolder.EditFunc[]>(() => []);

  /** Copy a file. */
  public copy(dst: string, src: string): void {
    this.copies.get(src).push(dst);
  }

  /** Edit a file. */
  public edit(file: string, f: ScenarioFolder.EditFunc): void {
    this.edits.get(file).push(f);
  }

  /**
   * Resize network function to specified quantity.
   * @param nf network function name.
   * @param count desired quantity.
   * @returns container names.
   */
  public resizeNetworkFunction(nf: string, count: number): string[];

  /**
   * Resize network function to specified quantity.
   * @param nf network function name.
   * @param list relevant objects.
   * @returns tuples of container name and relavant object.
   */
  public resizeNetworkFunction<T>(nf: string, list: readonly T[]): Array<[string, T]>;

  public resizeNetworkFunction(nf: string, arg2: any): any {
    if (Array.isArray(arg2)) {
      const list = arg2 as unknown[];
      return this.resizeNetworkFunction(nf, list.length).map((ct, i) => [ct, list[i]]);
    }

    const count = arg2 as number;
    assert(count >= 1);
    const ct1 = `${nf}1`;
    assert(this.ipmap.containers.has(ct1));
    const netifs = Array.from(this.ipmap.containers.get(ct1)!.keys());
    assert(this.files.has(`${ct1}.json`));

    const names = [ct1];
    for (let i = 2; i <= count; ++i) {
      const ct = `${nf}${i}`;
      names.push(ct);
      if (!this.ipmap.containers.has(ct)) {
        this.ipmap.addContainer(ct, netifs);
      }
      const ctFile = `${ct}.json`;
      this.files.delete(ctFile);
      this.copy(ctFile, `${ct1}.json`);
      this.edit(ctFile, (body) => body.replaceAll(ct1.toUpperCase(), ct.toUpperCase()));
    }
    for (let i = count + 1; i < 1000; ++i) {
      const ct = `${nf}${i}`;
      this.files.delete(`${ct}.json`);
      this.ipmap.removeContainer(ct);
    }
    return names;
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
  public appendSQL(db: string, g: () => AnyIterable<string>): void {
    this.edit(`sql/${db}.sql`, async (body) => {
      body += "\n";
      for await (const stmt of g()) {
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
    const unusedFiles = new Set([...this.copies.keys(), ...this.edits.keys()]);
    for (const src of this.files) {
      const srcPath = path.resolve(this.dir, src);
      unusedFiles.delete(src);
      for (const dst of [src, ...(this.copies.peek(src) ?? [])]) {
        unusedFiles.delete(dst);
        const dstPath = dst.startsWith("sql/") ? path.resolve(sql, dst.slice(4)) : path.resolve(cfg, dst);
        await fs.mkdir(path.dirname(dstPath), { recursive: true });
        const edit = this.edits.peek(dst);
        if (edit === undefined) {
          await fs.copyFile(srcPath, dstPath);
        } else {
          let body = await fs.readFile(srcPath, "utf8");
          for (const f of edit) {
            body = await f(body);
          }
          await fs.writeFile(dstPath, body);
        }
      }
    }

    if (unusedFiles.size > 0) {
      throw new Error(`missing files: ${Array.from(unusedFiles).join(" ")}`);
    }
  }
}
export namespace ScenarioFolder {
  export type EditFunc = (body: string) => string | Promise<string>;
}

async function* scanFiles(dir: string): AsyncIterable<string> {
  const walk = await fsWalkPromise(dir, {
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
  });
  for await (const entry of walk) {
    yield path.relative(dir, entry.path);
  }
}

async function parseEnv(body: string): Promise<Map<string, string>> {
  const env = new Map<string, string>();
  for (const [k, v] of Object.entries(envfile.parse(body))) {
    env.set(k.replace(/^export\s+/, ""), v.replace(/\s*#.*$/, ""));
  }
  return env;
}
