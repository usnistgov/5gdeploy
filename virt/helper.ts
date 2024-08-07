import * as compose from "../compose/mod.js";
import type { ComposeFile, ComposeService } from "../types/mod.js";

export function* iterVM(c: ComposeFile): Iterable<[s: ComposeService, name: string]> {
  for (const s of compose.listByAnnotation(c, "vmname", () => true)) {
    yield [s, compose.annotate(s, "vmname")!];
  }
}
