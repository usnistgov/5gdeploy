import path from "node:path";

import { execa } from "execa";
import yaml from "js-yaml";
import stringify from "json-stringify-deterministic";

import type { CN5G, ComposeFile } from "../types/mod.js";
import { file_io } from "../util/mod.js";
import type { OAIOpts } from "./options.js";

export const composePath = path.join(import.meta.dirname, "docker-compose");
export const convertCommand = path.join(import.meta.dirname, "libconf_convert.py");

/** Determine Docker image name with version tag. */
export async function getTaggedImageName(opts: OAIOpts, nf: string): Promise<string> {
  let tagOpt = opts["oai-cn5g-tag"];
  let filename = "docker-compose-slicing-basic-nrf.yaml";
  let image = `oaisoftwarealliance/oai-${nf}`;
  let dfltTag = "latest";
  switch (nf) {
    case "ue": {
      image = "oaisoftwarealliance/oai-nr-ue";
    }
    // fallthrough
    case "gnb": {
      tagOpt = opts["oai-ran-tag"];
      filename = "docker-compose-slicing-ransim.yaml";
      dfltTag = "develop";
      break;
    }
  }

  if (tagOpt) {
    return `${image}:${tagOpt}`;
  }

  const c = await file_io.readYAML(path.resolve(composePath, filename)) as ComposeFile;
  for (const s of Object.values(c.services)) {
    if (s.image.startsWith(`${image}:`)) {
      return s.image;
    }
  }
  return `${image}:${dfltTag}`;
}

/** Load OAI config from libconfig template file. */
export async function loadLibconf<T extends {}>(filename: string): Promise<T & { save: () => Promise<string> }> {
  let body = await file_io.readText(filename);
  body = body.replaceAll(/=\s*0+(\d+)\b/g, "= $1");

  const subprocess = await execa("python3", [convertCommand, "conf2json", path.basename(filename)], {
    cwd: path.dirname(filename),
    input: body,
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
    input: stringify(this),
    stdout: "pipe",
    stderr: "inherit",
  });
  return subprocess.stdout;
}

/** Load OAI CN5G config.yaml file. */
export async function loadCN5G(): Promise<CN5G.Config> {
  const c = await file_io.readYAML(path.resolve(composePath, "conf/basic_nrf_config.yaml"), {
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
