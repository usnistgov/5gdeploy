import path from "node:path";

import * as yaml from "js-yaml";

import { compose, netdef } from "../netdef-compose/mod.js";
import type { ComposeService, F5 } from "../types/mod.js";
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
  const { sst, sd } = netdef.splitSNSSAI(input).ih;
  return { sst, sd: sd?.toLowerCase() };
}

export function mountTmpfsVolumes(s: ComposeService): void {
  s.volumes.push({
    type: "tmpfs",
    source: "",
    target: "/free5gc/config",
  }, {
    type: "tmpfs",
    source: "",
    target: "/free5gc/cert",
  });
}
