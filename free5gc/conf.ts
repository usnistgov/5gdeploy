import path from "node:path";

import yaml from "js-yaml";

import { file_io } from "../util/mod.js";

/** Retrieve free5GC Docker image name. */
export async function getImage(nf: string): Promise<string> {
  const prefix = `free5gc/${nf.toLowerCase()}:`;
  const images = (await file_io.readText(path.join(import.meta.dirname, "images.txt"), { once: true })).split("\n");
  for (const image of images) {
    if (image.startsWith(prefix)) {
      return image;
    }
  }
  throw new Error(`no image found for ${nf}`);
}

/** Load free5GC YAML config. */
export function loadTemplate(tpl: string): Promise<unknown> {
  return file_io.readYAML(
    path.join(import.meta.dirname, `free5gc-compose/config/${tpl}.yaml`),
    { once: true, schema: yaml.CORE_SCHEMA },
  );
}
