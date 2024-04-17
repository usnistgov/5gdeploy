import path from "node:path";

import { execa } from "execa";
import yaml from "js-yaml";

import type { CN5G } from "../types/mod.js";
import { file_io } from "../util/mod.js";

export const templatePath = path.join(import.meta.dirname, "conf_files");
export const cn5gPath = path.join(import.meta.dirname, "docker-compose");
export const convertCommand = path.join(import.meta.dirname, "libconf_convert.py");

/** Retrieve OAI git repository tag name. */
export async function getTag(): Promise<string> {
  return (await file_io.readText(path.resolve(templatePath, "TAG"), { once: true })).trim();
}

/** Load OAI config from libconfig template file. */
export async function loadLibconf<T extends {}>(tpl: string): Promise<T & { save: () => Promise<string> }> {
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
    value: saveLibconf,
  });
  return c;
}

/** Save OAI config `this` to libconfig string. */
async function saveLibconf(this: unknown): Promise<string> {
  const subprocess = await execa("python3", [convertCommand, "json2conf"], {
    input: JSON.stringify(this),
    stdout: "pipe",
    stderr: "inherit",
  });
  return subprocess.stdout;
}

/** Load OAI CN5G config.yaml file. */
export async function loadCN5G(): Promise<CN5G.Config> {
  const c = await file_io.readYAML(path.resolve(cn5gPath, "conf/basic_nrf_config.yaml"), {
    schema: yaml.FAILSAFE_SCHEMA,
  });
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
