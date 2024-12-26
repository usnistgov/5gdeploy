import fs from "node:fs/promises";
import path from "node:path";

import asTable from "as-table";
import { parse as csvParse, type parser as csvParser, stringify as csvStringify } from "csv/sync";
import getStdin from "get-stdin";
import * as yaml from "js-yaml";
import stringify from "json-stringify-deterministic";
import * as jsonc from "jsonc-parser";
import DefaultMap from "mnemonist/default-map.js";
import { type AnyIterable, collect } from "streaming-iterables";
import type { Promisable } from "type-fest";

function doReadText(filename: string): Promise<string> {
  return filename === "-" ? getStdin() : fs.readFile(filename, "utf8");
}
const readOnce = new DefaultMap((filename: string) => doReadText(filename));

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
 * Read file as UTF-8 text and parse as JSON or JSON with comments.
 * @param filename - Filename, "-" for stdin.
 */
export async function readJSON(filename: string, opts: readText.Options = {}): Promise<unknown> {
  const errors: jsonc.ParseError[] = [];
  const value = jsonc.parse(await readText(filename, opts), errors);
  if (errors.length > 0) {
    throw new Error(`JSONC parse errors: ${JSON.stringify(errors)}`);
  }
  return value;
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

let tableDelim: string[] | undefined;

/**
 * Read file as UTF-8 text and parse as TSV/CSV table.
 * @param filename - Filename, "-" for stdin.
 *
 * @remarks
 * Space delimited input files are supported, for up to 64 consecutive spaces.
 */
export async function readTable(filename: string, opts: readTable.Options = {}): Promise<unknown> {
  if (!tableDelim) {
    tableDelim = [",", "\t"];
    for (let i = 64; i >= 1; --i) {
      tableDelim.push(" ".repeat(i));
    }
  }

  return csvParse(await readText(filename, opts), {
    cast: opts.cast ?? false,
    columns: opts.columns ?? false,
    comment: "#",
    delimiter: tableDelim,
    skipEmptyLines: true,
    trim: true,
  });
}
export namespace readTable {
  export interface Options extends readText.Options, Pick<csvParser.Options, "cast" | "columns"> {
  }
}

/**
 * Write file.
 * @param filename - Filename, "-" or "-.*" for stdout.
 * @param body - File content.
 *
 * @remarks
 * If `body.save` is a function, its return value is used as body.
 *
 * {@link write.MKDIR} makes a directory instead of writing a file.
 * Uint8Array and string are written directly.
 * String arrays and iterables are joined as lines, when filename ends with ".sh".
 * Other types are serialized as either JSON or YAML (when filename ends with ".yaml" or ".yml").
 *
 * Parent directories are created automatically.
 * File is set to executable when filename ends with ".sh".
 */
export async function write(filename: string, body: unknown, { executable }: write.Options = {}): Promise<void> {
  while (typeof (body as Partial<write.Saver>).save === "function") {
    body = await (body as write.Saver).save();
  }

  if (body === write.MKDIR) {
    await fs.mkdir(filename, { recursive: true });
    return;
  }

  if (typeof body === "string" || body instanceof Uint8Array) {
    //
  } else if (filename.endsWith(".sh") && (
    typeof (body as Iterable<string>)[Symbol.iterator] === "function" ||
    typeof (body as AsyncIterable<string>)[Symbol.asyncIterator] === "function"
  )) {
    body = (await collect(body as AnyIterable<string>)).join("\n");
  } else if (filename.endsWith(".yaml") || filename.endsWith(".yml")) {
    const yamlOpts: yaml.DumpOptions = {
      lineWidth: -1,
      noRefs: true,
      sortKeys: true,
      // for Compose file: don't force quotes, to make multi-line shell scripts more readable
      // for other YAML files: force quotes, to distinguish string and number/boolean types
      forceQuotes: !path.basename(filename).startsWith("compose."),
    };
    body = yaml.dump(body, yamlOpts);
  } else {
    body = stringify(body, { space: "  " });
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
  if (executable ?? filename.endsWith(".sh")) {
    await fs.chmod(filename, 0o755);
  }
}
export namespace write {
  export interface Options {
    /**
     * Whether to chmod as executable.
     * @defaultValue true for *.sh, false otherwise.
     */
    executable?: boolean;
  }

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
      return csvStringify(table as any[], {
        delimiter: "\t",
        header: true,
        columns,
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
