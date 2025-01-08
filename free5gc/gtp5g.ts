import { compose } from "../netdef-compose/mod.js";
import type { ComposeFile, ComposeService } from "../types/mod.js";
import type { F5Opts } from "./options.js";

/** Declare a service that depends on gtp5g kernel module. */
export function dependOnGtp5g(dependant: ComposeService, c: ComposeFile, opts: F5Opts): void {
  if (!c.services.gtp5g) {
    defineGtp5gLoader(c, opts);
  }

  dependant.depends_on.gtp5g = {
    condition: "service_completed_successfully",
  };
}

function defineGtp5gLoader(c: ComposeFile, opts: F5Opts): void {
  const s = compose.defineService(c, "gtp5g", "5gdeploy.localhost/gtp5g");
  compose.annotate(s, "every_host", 1);
  compose.annotate(s, "only_if_needed", 1);
  s.environment.GTP5G_DBG = `${opts["gtp5g-dbg"]}`;
  s.environment.GTP5G_QOS = opts["gtp5g-qos"] ? "1" : "0";
  s.environment.GTP5G_SEQ = opts["gtp5g-seq"] ? "1" : "0";

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
