import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import fsWalk from "@nodelib/fs.walk";
import * as envfile from "envfile";
import assert from "minimalistic-assert";
import DefaultMap from "mnemonist/default-map.js";
import type MultiMap from "mnemonist/multi-map.js";
import { type AnyIterable, collect } from "streaming-iterables";

import { IPMAP } from "./ipmap.js";
import { NetworkFunction } from "./nf.js";
import { OtherTable } from "./other.js";

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
    const other = OtherTable.parse(await fs.readFile(path.resolve(dir, "other"), "utf8"));
    return new ScenarioFolder(dir, files, ipmap, other, env);
  }

  private constructor(
      private readonly dir: string,
      public readonly files: Set<string>,
      public readonly ipmap: IPMAP,
      private readonly other: OtherTable,
      public readonly env: Map<string, string>,
  ) {
    this.edit("ip-map", () => this.ipmap.save());
    this.edit("other", () => this.other.save());

    this.edit("env.sh", () => {
      const obj: envfile.Input = {};
      for (const [k, v] of this.env) {
        obj[`export ${k}`] = v;
      }
      return envfile.stringify(obj);
    });
  }

  public get initCommands(): DefaultMap<string, string[]> {
    return this.other.commands;
  }

  public get routes(): MultiMap<string, OtherTable.Route> {
    return this.other.routes;
  }

  private readonly copies = new DefaultMap<string, string[]>(() => []);
  private readonly edits = new DefaultMap<string, ScenarioFolder.EditFunc[]>(() => []);

  /** Copy a file. */
  public copy(dst: string, src: string): void {
    this.copies.get(src).push(dst);
  }

  /** Edit a file. */
  public edit(file: string, sf: ScenarioFolder.EditFunc): void {
    this.edits.get(file).push(sf);
  }

  /**
   * Scale network function to specified quantity.
   * @param tpl template container name(s); if multiple, try in order.
   * @param list relevant config objects.
   * If a config object has a .name property, it must reflect the templated network function.
   */
  public scaleNetworkFunction<T>(tplNames: string | readonly string[], list: readonly T[]): Map<string, T> {
    const tpl = (typeof tplNames === "string" ? [tplNames] : tplNames).find((tpl) => this.ipmap.containers.has(tpl));
    assert(tpl, "template container not found");
    assert(this.files.has(`${tpl}.json`));
    assert(list.length > 0);

    const nf = IPMAP.toNf(tpl);
    const netifs = Array.from(this.ipmap.containers.get(tpl)!.keys());

    const m = IPMAP.suggestNames(nf, list);
    const { removed } = this.ipmap.scaleContainers([...m.keys()], netifs);
    for (const ct of m.keys()) {
      const ctFile = `${ct}.json`;
      if (ct !== tpl) {
        this.files.delete(ctFile);
        this.copy(ctFile, `${tpl}.json`);
        this.edit(ctFile, (body) => body.replaceAll(`%${tpl.toUpperCase()}_`, `%${ct.toUpperCase()}_`));
        this.initCommands.get(ct).push(...(this.initCommands.peek(tpl) ?? []));
        for (const route of (this.routes.get(tpl) ?? [])) {
          this.routes.set(ct, route);
        }
      }
      this.editNetworkFunction(ct, (c) => {
        const command = c.getModule("command", true);
        if (command) {
          command.config.GreetingText = `${ct.toUpperCase()}>`;
        }
        const nrfClient = c.getModule("nrf_client", true);
        if (nrfClient) {
          nrfClient.config.nf_profile.nfInstanceId = globalThis.crypto.randomUUID();
        }
      });
    }

    removed.delete(tpl);
    for (const ct of removed) {
      this.files.delete(`${ct}.json`);
      this.initCommands.delete(ct);
      this.routes.delete(ct);
    }
    return m;
  }

  /** Edit a network function .json file. */
  public editNetworkFunction(ct: string, f: (c: NetworkFunction) => void | Promise<void>): void {
    this.edit(`${ct}.json`, async (body) => {
      const c = NetworkFunction.parse(body);
      await f(c);
      return c.save();
    });
  }

  /** Append SQL statements to a database. */
  public appendSQL(db: string, g: () => AnyIterable<string>): void {
    this.edit(`sql/${db}.sql`, async (body) => {
      body += "\n";
      for await (let stmt of g()) {
        stmt = stmt.trim().replace(/\n\s+/g, " ");
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

    const missingFiles = new Set([...this.copies.keys(), ...this.edits.keys()]);
    for (const src of this.files) {
      const srcPath = path.resolve(this.dir, src);
      missingFiles.delete(src);
      for (const dst of [src, ...(this.copies.peek(src) ?? [])]) {
        missingFiles.delete(dst);
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

    if (missingFiles.size > 0) {
      throw new Error(`missing files: ${Array.from(missingFiles).join(" ")}`);
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
  for (const entry of walk) {
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
