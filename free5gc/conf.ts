import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";
import DefaultMap from "mnemonist/default-map.js";

const composePath = fileURLToPath(new URL("free5gc-compose", import.meta.url));

const readOnce = new DefaultMap<string, string>((filename) => {
  filename = path.resolve(composePath, filename);
  return readFileSync(filename, "utf8");
});

/** Retrieve free5GC Docker image name. */
export function getImage(nf: string): string {
  const prefix = `free5gc/${nf.toLowerCase()}:`;
  const images = readOnce.get("../images.txt").split("\n");
  for (const image of images) {
    if (image.startsWith(prefix)) {
      return image;
    }
  }
  throw new Error(`no image found for ${nf}`);
}

/** Load free5GC YAML config. */
export function loadTemplate(tpl: string): unknown {
  return yaml.load(readOnce.get(`config/${tpl}.yaml`), {
    schema: yaml.CORE_SCHEMA,
  });
}
