import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import fsWalk from "@nodelib/fs.walk";
import * as envfile from "envfile";
import assert from "minimalistic-assert";
import type DefaultMap from "mnemonist/default-map.js";
import type MultiMap from "mnemonist/multi-map.js";
import { type AnyIterable } from "streaming-iterables";
import type { Promisable } from "type-fest";

import * as compose from "../compose/mod.js";
import { IPMAP } from "./ipmap.js";
import { NetworkFunction } from "./nf.js";
import { OtherTable } from "./other.js";

const fsWalkPromise = promisify(fsWalk.walk);

/** ph_init scenario folder. */
export class ScenarioFolder {
  /**
   * Load from directory.
   * @param dir - `phoenix-src/cfg/*` subfolder.
   */
  public static async load(dir: string): Promise<ScenarioFolder> {
    const sf = new ScenarioFolder();
    sf.env = parseEnv(await fs.readFile(path.resolve(dir, "env.sh"), "utf8"));
    sf.ipmap = IPMAP.parse(await fs.readFile(path.resolve(dir, "ip-map"), "utf8"), sf.env);
    sf.other = OtherTable.parse(await fs.readFile(path.resolve(dir, "other"), "utf8"));

    const walk = await fsWalkPromise(dir, {
      entryFilter(entry) {
        if (!entry.dirent.isFile()) {
          return false;
        }
        if (entry.path.includes("/sql/")) {
          return entry.name.endsWith(".sql");
        }
        return !["env.sh", "ip-map", "other"].includes(entry.name) && !entry.name.endsWith("-root");
      },
      deepFilter({ name }) {
        return name !== "prometheus";
      },
    });
    for (const entry of walk) {
      sf.createFrom(path.relative(dir, entry.path), entry.path);
    }
    return sf;
  }

  private files = new Map<string, FileAction>();
  /** Environment variables in `env.sh`. */
  public env = new Map<string, string>();
  /** IP address assignments in `ip-map`. */
  public ipmap = IPMAP.parse("");
  /** Per-container initialization commands and routes. */
  public other = new OtherTable();

  /** Per-container initialization commands. */
  public get initCommands(): DefaultMap<string, string[]> {
    return this.other.commands;
  }

  /** Per-container IPv4 routes. */
  public get routes(): MultiMap<string, OtherTable.Route> {
    return this.other.routes;
  }

  /** Report whether a file exists. */
  public has(file: string): boolean {
    return this.files.has(file);
  }

  /** Create a file from an external file. */
  public createFrom(dst: string, src: string): void {
    this.files.set(dst, { readFromFile: src, edits: [] });
  }

  /** Duplicate a file without pending edits. */
  public copy(dst: string, src: string): void {
    const fa = this.files.get(src);
    assert(fa, "source file not found");
    this.files.set(dst, { readFromFile: fa.readFromFile, initialContent: fa.initialContent, edits: [] });
  }

  /** Edit a file. */
  public edit(file: string, f: ScenarioFolder.EditFunc): void {
    const fa = this.files.get(file);
    assert(fa, "file not found");
    fa.edits.push(f);
  }

  /** Delete a file. */
  public delete(file: string): void {
    this.files.delete(file);
  }

  /** Edit a network function JSON file. */
  public editNetworkFunction(ct: string, ...edits: ReadonlyArray<(c: NetworkFunction) => void | Promise<void>>): void {
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
    await fs.mkdir(cfg, { recursive: true });

    for (const [dst, fa] of this.files) {
      const dstPath = dst.startsWith("sql/") ? path.resolve(sql, dst.slice(4)) : path.resolve(cfg, dst);
      await fs.mkdir(path.dirname(dstPath), { recursive: true });
      if (fa.readFromFile && fa.edits.length === 0) {
        await fs.copyFile(fa.readFromFile, dstPath);
        continue;
      }

      let body = fa.readFromFile ? await fs.readFile(fa.readFromFile, "utf8") : (fa.initialContent ?? "");
      for (const edit of fa.edits) {
        body = await edit(body);
      }
      await fs.writeFile(dstPath, body);
    }

    await fs.writeFile(path.resolve(cfg, "env.sh"), saveEnv(this.env));
    await fs.writeFile(path.resolve(cfg, "ip-map"), this.ipmap.save());
    await fs.writeFile(path.resolve(cfg, "other"), this.other.save());
  }
}
export namespace ScenarioFolder {
  export type EditFunc = (body: string) => Promisable<string>;
}

interface FileAction {
  initialContent?: string;
  readFromFile?: string;
  edits: ScenarioFolder.EditFunc[];
}

function parseEnv(body: string): Map<string, string> {
  const env = new Map<string, string>();
  for (const [k, v] of Object.entries(envfile.parse(body))) {
    env.set(k.replace(/^export\s+/, ""), v.replace(/\s*#.*$/, ""));
  }
  return env;
}

function saveEnv(env: Map<string, string>): string {
  const obj: envfile.Input = {};
  for (const [k, v] of env) {
    obj[`export ${k}`] = v;
  }
  return envfile.stringify(obj);
}
