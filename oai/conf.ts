import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import yaml from "js-yaml";

import type * as CN5G from "../types/oai-cn5g.js";

let tag: string | undefined;
export const templatePath = fileURLToPath(new URL("conf_files", import.meta.url));
export const cn5gPath = fileURLToPath(new URL("docker-compose", import.meta.url));
export const convertCommand = fileURLToPath(new URL("convert.py", import.meta.url));

/** Retrieve OAI git repository tag name. */
export async function getTag(): Promise<string> {
  tag ??= (await fs.readFile(path.resolve(templatePath, "TAG"), "utf8")).trim();
  return tag;
}

/** Load OAI config from libconfig template. */
export async function loadTemplate<T extends {}>(tpl: string): Promise<T & { save(): Promise<string> }> {
  const subprocess = await execa("python3", [convertCommand, "conf2json", `${tpl}.conf`], {
    cwd: templatePath,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
  const c = JSON.parse(subprocess.stdout);
  Object.defineProperty(c, "save", {
    configurable: true,
    enumerable: false,
    value: save,
  });
  return c;
}

/** Save OAI config 'this' to libconfig string. */
async function save(this: unknown): Promise<string> {
  const subprocess = await execa("python3", [convertCommand, "json2conf"], {
    input: JSON.stringify(this),
    stdout: "pipe",
    stderr: "inherit",
  });
  return subprocess.stdout;
}

/** Load OAI CN5G config.yaml file. */
export async function loadCN5G(): Promise<CN5G.Config> {
  const c = yaml.load(
    await fs.readFile(path.resolve(cn5gPath, "conf/basic_nrf_config.yaml"), "utf8"),
    { schema: yaml.FAILSAFE_SCHEMA },
  );
  return JSON.parse(JSON.stringify(c, (key, value) => {
    switch (value) {
      case "true":
      case "yes": {
        return true;
      }
      case "false":
      case "no": {
        return false;
      }
    }
    if (typeof value === "string" && /^\d+$/.test(value) &&
        !["sd", "mcc", "mnc", "amf_region_id", "amf_set_id", "amf_pointer", "dnn"].includes(key)) {
      return Number.parseInt(value, 10);
    }
    return value;
  }));
}
