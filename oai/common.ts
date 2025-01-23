import fs from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import * as yaml from "js-yaml";
import stringify from "json-stringify-deterministic";

import { compose, type netdef } from "../netdef-compose/mod.js";
import type { CN5G } from "../types/mod.js";
import { file_io } from "../util/mod.js";
import type { OAIOpts } from "./options.js";

export const composePath = path.join(import.meta.dirname, "docker-compose");
export const convertCommand = path.join(import.meta.dirname, "libconf_convert.py");

/** Determine OAI Docker image name with version tag. */
export async function getTaggedImageName(opts: OAIOpts, nf: string): Promise<string> {
  let tagOpt = opts["oai-cn5g-tag"];
  let filename = "docker-compose-slicing-basic-nrf.yaml";
  let image = `oaisoftwarealliance/oai-${nf}`;
  let dfltTag = "latest";
  switch (nf) {
    case "upf-vpp": {
      filename = "docker-compose-basic-vpp-nrf.yaml";
      break;
    }
    case "ue": {
      image = "oaisoftwarealliance/oai-nr-ue";
      // fallthrough
    }
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
  return await compose.getTaggedImageName(path.resolve(composePath, filename), image) ?? `${image}:${dfltTag}`;
}

/**
 * Load OAI config from libconfig file.
 * @param filename - Either a libconfig filename or a directory name.
 * @param ct - If `filename` refers to a directory, use `${ct}.conf` in the directory.
 * @returns File content converted to JSON.
 */
export async function loadLibconf<T extends {}>(filename: string, ct?: string): Promise<T & { save: () => Promise<string> }> {
  const stat = await fs.stat(filename);
  if (stat.isDirectory() && ct) {
    filename = path.join(filename, `${ct}.conf`);
  }
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
    once: true,
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

export function makeUpfFqdn(name: string, { mcc, mnc }: netdef.PLMN): string {
  // https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-upf-vpp/-/blob/7f0065980493ebc49d5e8ce8ca5a9498878c110a/scripts/upf_conf/create_configuration.py#L240
  return `${makeUpfFqdn.cleanName(name)}.node.5gcn.mnc${mnc}.mcc${mcc}.${makeUpfFqdn.realm}`;
}
export namespace makeUpfFqdn {
  export function cleanName(name: string): string {
    return name.toLowerCase().replaceAll(/[^\da-z]/gi, "-").replaceAll(/^-|-$/g, "");
  }

  export const realm = "3gppnetwork.org";
}
