import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

const templatePath = fileURLToPath(new URL("conf_files", import.meta.url));
const convertCommand = fileURLToPath(new URL("convert.py", import.meta.url));

/** Retrieve OAI git repository tag name. */
export async function getTag(): Promise<string> {
  return (await fs.readFile(path.resolve(templatePath, "TAG"), "utf8")).trim();
}

/** Load OAI config from libconfig template. */
export async function loadTemplate(tpl: string): Promise<unknown> {
  const process = await execa("python3", [convertCommand, "conf2json", `${tpl}.conf`], {
    cwd: templatePath,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
  return JSON.parse(process.stdout);
}

/** Save OAI config to libconfig string. */
export async function save(c: unknown): Promise<string> {
  const process = await execa("python3", [convertCommand, "json2conf"], {
    input: JSON.stringify(c),
    stdout: "pipe",
    stderr: "inherit",
  });
  return process.stdout;
}
