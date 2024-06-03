import * as compose from "../compose/mod.js";
import type { ComposeFile, ComposeService } from "../types/mod.js";

export function dependOnGtp5g(dependant: ComposeService, c: ComposeFile): void {
  if (!c.services.gtp5g) {
    defineGtp5gLoader(c);
  }

  dependant.depends_on.gtp5g = {
    condition: "service_completed_successfully",
  };
}

function defineGtp5gLoader(c: ComposeFile): void {
  const s = compose.defineService(c, "gtp5g", "5gdeploy.localhost/gtp5g");
  compose.annotate(s, "every_host", 1);

  s.network_mode = "none";
  s.cap_add.push("SYS_MODULE");
  s.volumes.push({
    type: "bind",
    source: "/etc/modules-load.d",
    target: "/etc/modules-load.d",
  }, {
    type: "bind",
    source: "/lib/modules",
    target: "/lib/modules",
  }, {
    type: "bind",
    source: "/usr/src",
    target: "/usr/src",
    read_only: true,
  });
}
