import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";
import PLazy from "p-lazy";

import type { ComposeFile } from "../types/compose.js";

const composePath = fileURLToPath(new URL("free5gc-compose", import.meta.url));

const composeFilePromise = new PLazy(async (resolve) => {
  resolve(yaml.load(await fs.readFile(path.resolve(composePath, "docker-compose.yaml"), "utf8")));
});

/** Retrieve free5GC Docker image name. */
export async function getImage(nf: string): Promise<string> {
  const prefix = `free5gc/${nf.toLowerCase()}:`;
  const compose = (await composeFilePromise) as ComposeFile;
  for (const { image } of Object.values(compose.services)) {
    if (image.startsWith(prefix)) {
      return image;
    }
  }
  throw new Error(`no image found for ${nf}`);
}

/** Load free5GC YAML config. */
export async function loadTemplate(tpl: string): Promise<unknown> {
  return yaml.load(await fs.readFile(path.resolve(composePath, "config", `${tpl}.yaml`), "utf8"));
}
