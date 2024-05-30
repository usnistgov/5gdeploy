import path from "node:path";

import yaml from "js-yaml";

import * as compose from "../compose/mod.js";
import { file_io } from "../util/mod.js";

/** Determine OAI Docker image name with version tag. */
export async function getTaggedImageName(nf: string): Promise<string> {
  const image = `free5gc/${nf.toLowerCase()}`;
  const tagged = await compose.getTaggedImageName(path.resolve(import.meta.dirname, "free5gc-compose/docker-compose.yaml"), image);
  if (!tagged) {
    throw new Error(`no image found for ${nf}`);
  }
  return tagged;
}

/** Load free5GC YAML config. */
export function loadTemplate(tpl: string): Promise<unknown> {
  return file_io.readYAML(
    path.join(import.meta.dirname, `free5gc-compose/config/${tpl}.yaml`),
    { once: true, schema: yaml.CORE_SCHEMA },
  );
}
