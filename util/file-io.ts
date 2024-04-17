import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import fsWalkLib from "@nodelib/fs.walk";
import asTable from "as-table";
import { stringify as csv } from "csv-stringify/sync";
import getStdin from "get-stdin";
import yaml from "js-yaml";
import stringify from "json-stringify-deterministic";
import DefaultMap from "mnemonist/default-map.js";
import type { Promisable } from "type-fest";

export const fsWalk = promisify(fsWalkLib.walk);

function doReadText(filename: string): Promise<string> {
  return filename === "-" ? getStdin() : fs.readFile(filename, "utf8");
}

const readOnce = new DefaultMap<string, Promise<string>>(
  (filename) => doReadText(filename),
);

/**
 * Read file as UTF-8 text.
 * @param filename - Filename, "-" for stdin.
 */
export function readText(filename: string, { once = false }: readText.Options = {}): Promise<string> {
  if (once) {
    return readOnce.get(filename);
  }
  return doReadText(filename);
}
export namespace readText {
  /** {@link readText} options. */
  export interface Options {
    /**
     * If `true`, file is read only once and then cached.
     * @defaultValue false
     */
    once?: boolean;
  }
}

/**
 * Read file as UTF-8 text and parse as JSON.
 * @param filename - Filename, "-" for stdin.
 */
export async function readJSON(filename: string, opts: readText.Options = {}): Promise<unknown> {
  return JSON.parse(await readText(filename, opts));
}

/**
 * Read file as UTF-8 text and parse as YAML.
 * @param filename - Filename, "-" for stdin.
 */
export async function readYAML(filename: string, opts: readYAML.Options = {}): Promise<unknown> {
  return yaml.load(await readText(filename, opts), {
    filename,
    schema: opts.schema,
  });
}
export namespace readYAML {
  /** {@link readYAML} options. */
  export interface Options extends readText.Options, Pick<yaml.LoadOptions, "schema"> {
  }
}

/**
 * Write file.
 * @param filename - Filename, "-" or "-.*" for stdout.
 * @param body - File content; {@link MKDIR} to make directory instead of file.
 *
 * @remarks
 * If `body.save` is a function, its return value is used as body.
 *
 * Uint8Array and string are written directly.
 * Other types are serialized as either JSON or YAML (when filename ends with ".yaml" or ".yml").
 *
 * Parent directories are created automatically.
 * File is set to executable when filename ends with ".sh".
 */
export async function write(filename: string, body: unknown): Promise<void> {
  while (typeof (body as Partial<write.Saver>).save === "function") {
    body = await (body as write.Saver).save();
  }

  if (body === write.MKDIR) {
    await fs.mkdir(filename, { recursive: true });
    return;
  }

  if (!(typeof body === "string" || body instanceof Uint8Array)) {
    if (filename.endsWith(".yaml") || filename.endsWith(".yml")) {
      body = yaml.dump(body, { forceQuotes: true, noRefs: true, sortKeys: true });
    } else {
      body = stringify(body, { space: "  " });
    }
  }

  if (filename === "-" || filename.startsWith("-.")) {
    if (typeof body === "string" && !body.endsWith("\n")) {
      body += "\n";
    }
    process.stdout.write(body as string | Uint8Array);
    return;
  }

  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, body as string | Uint8Array);
  if (filename.endsWith(".sh")) {
    await fs.chmod(filename, 0o755);
  }
}
export namespace write {
  /** When passed as `body`, the return value of `body.save()` is used as body. */
  export interface Saver {
    save: () => Promisable<unknown>;
  }

  /** When passed as `body`, make directory instead of write file. */
  export const MKDIR = Symbol("5gdeploy#file_io.MKDIR");

  /** When passed as `body`, copy from file. */
  export function copyFrom(filename: string | URL): unknown {
    return {
      save() {
        return fs.readFile(filename);
      },
    } satisfies Saver;
  }
}

/** Arrange a table into textual format. */
export function toTable(
    columns: readonly string[],
    table: ReadonlyArray<ReadonlyArray<string | number>>,
): toTable.Result {
  return {
    get tsv() {
      return csv(table as any[], {
        delimiter: "\t",
        header: true,
        columns: columns as string[],
      });
    },
    get tui() {
      return asTable([columns, ...table]);
    },
  };
}
export namespace toTable {
  export interface Result {
    /** TAB separated values format. */
    readonly tsv: string;
    /** Terminal UI format. */
    readonly tui: string;
  }
}
