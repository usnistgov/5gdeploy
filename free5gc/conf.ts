import path from "node:path";

import * as yaml from "js-yaml";

import { compose } from "../netdef-compose/mod.js";
import type { ComposeService } from "../types/mod.js";
import { file_io } from "../util/mod.js";
import type { F5Opts } from "./options.js";

/** Determine free5GC Docker image name with version tag. */
export async function getTaggedImageName(opts: F5Opts, nf: string): Promise<string> {
  const repo = `free5gc/${nf.toLowerCase()}`;
  const optTag = opts["free5gc-tag"];
  if (optTag) {
    return `${repo}:${optTag}`;
  }

  const tagged = await compose.getTaggedImageName(
    path.join(import.meta.dirname, "free5gc-compose/docker-compose.yaml"),
    repo,
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
