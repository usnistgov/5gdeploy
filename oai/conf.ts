import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

let tag: string | undefined;
const templatePath = fileURLToPath(new URL("conf_files", import.meta.url));
const convertCommand = fileURLToPath(new URL("convert.py", import.meta.url));

/** Retrieve OAI git repository tag name. */
export async function getTag(): Promise<string> {
  tag ??= (await fs.readFile(path.resolve(templatePath, "TAG"), "utf8")).trim();
  return tag;
}

/** Load OAI config from libconfig template. */
export async function loadTemplate<T extends {}>(tpl: string): Promise<T & { save(): Promise<string> }> {
  const process = await execa("python3", [convertCommand, "conf2json", `${tpl}.conf`], {
    cwd: templatePath,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
  const c = JSON.parse(process.stdout);
  Object.defineProperty(c, "save", {
    configurable: true,
    enumerable: false,
    value: save,
  });
  return c;
}

/** Save OAI config 'this' to libconfig string. */
async function save(this: unknown): Promise<string> {
  const process = await execa("python3", [convertCommand, "json2conf"], {
    input: JSON.stringify(this),
    stdout: "pipe",
    stderr: "inherit",
  });
  return process.stdout;
}
