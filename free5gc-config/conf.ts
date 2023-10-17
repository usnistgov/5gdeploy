import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";
import DefaultMap from "mnemonist/default-map.js";

const composePath = fileURLToPath(new URL("free5gc-compose", import.meta.url));

const readOnce = new DefaultMap<string, Promise<string>>((filename) => {
  filename = path.resolve(composePath, filename);
  return fs.readFile(filename, "utf8");
});

/** Retrieve free5GC Docker image name. */
export async function getImage(nf: string): Promise<string> {
  const prefix = `free5gc/${nf.toLowerCase()}:`;
  const images = (await readOnce.get("../images.txt")).split("\n");
  for (const image of images) {
    if (image.startsWith(prefix)) {
      return image;
    }
  }
  throw new Error(`no image found for ${nf}`);
}

/** Load free5GC YAML config. */
export async function loadTemplate(tpl: string): Promise<unknown> {
  return yaml.load(await readOnce.get(`config/${tpl}.yaml`));
}
