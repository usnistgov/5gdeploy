import type { ComposeFile } from "../types/compose.js";
import { file_io } from "../util/mod.js";

/**
 * Determine Docker image name with version tag.
 * @param filename - Compose filename.
 * @param image - Untagged image name.
 * @returns Tagged image name, or undefined if not found.
 */
export async function getTaggedImageName(filename: string, image: string): Promise<string | undefined> {
  const c = await file_io.readYAML(filename, { once: true }) as ComposeFile;
  for (const s of Object.values(c.services)) {
    if (s.image.startsWith(`${image}:`)) {
      return s.image;
    }
  }
  return undefined;
}
