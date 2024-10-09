import path from "node:path";

import * as yaml from "js-yaml";

import * as compose from "../compose/mod.js";
import { NetDef } from "../netdef/netdef.js";
import type { F5 } from "../types/mod.js";
import { file_io } from "../util/mod.js";

/** Determine free5GC Docker image name with version tag. */
export async function getTaggedImageName(nf: string): Promise<string> {
  const tagged = await compose.getTaggedImageName(
    path.join(import.meta.dirname, "free5gc-compose/docker-compose.yaml"),
    `free5gc/${nf.toLowerCase()}`,
  );
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

export function convertSNSSAI(input: string): F5.SNSSAI {
  const { sst, sd } = NetDef.splitSNSSAI(input).ih;
  return { sst, sd: sd?.toLowerCase() };
}
