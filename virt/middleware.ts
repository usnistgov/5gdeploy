import path from "node:path";

import type { WritableDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import type { ComposeFile, ComposeService } from "../types/mod.js";
import { file_io, type YargsInfer, type YargsOptions } from "../util/mod.js";

/** Yargs options definition for placing Compose services onto virtual machines. */
export const useVmOptions = {
  "use-vm": {
    desc: "Compose context for virtual machines recognized in --place and --bridge flags",
    normalize: true,
    type: "string",
  },
  "vm-list": {
    coerce(): Record<string, string> {
      return {};
    },
    hidden: true,
    type: "string",
  },
} as const satisfies YargsOptions;

/**
 * Serve as yargs middleware for netdef-compose command.
 *
 * @remarks
 * With this middleware, --place flags and Ethernet bridges can refer to virtual machines by name.
 *
 * In a --place flag, a VM can be referred as "vm-name" in place of its vmctrl IP address.
 * This is achieved by defining an SSH URI for the "vm-name" host.
 *
 * In a --bridge flag for Ethernet bridge, a VM interface can be referred as "vm-name" or "vm-name:netif".
 * "netif" defaults for the bridge network name.
 * This is achieved by performing regex replacements on bridge flags.
 */
export async function useVm(opts: WritableDeep<YargsInfer<typeof useVmOptions> &
  YargsInfer<typeof compose.placeOptions> & YargsInfer<typeof compose.bridgeOptions>>) {
  opts["vm-list"] = {};
  if (!opts["use-vm"]) {
    return;
  }
  const c = await file_io.readYAML(path.join(opts["use-vm"], "compose.yml")) as ComposeFile;

  for (const [s, name] of iterVm(c)) {
    const ip = compose.getIP(s, "vmctrl");
    const sshUri = `root@${ip}`;
    (opts["ssh-uri"] ??= {})[`vm-${name}`] = sshUri;
    opts["vm-list"][sshUri] = name;
  }

  compose.setBridgeResolveFn("vx", (net, ref) => {
    void net;
    if (ref === "ctrlif") {
      return compose.getIP(c, "virt_ctrlif", "vmctrl");
    }
    if (ref.startsWith("vm-")) {
      return compose.getIP(c, `vm_${ref.slice(3)}`, "vmctrl");
    }
    return undefined;
  });
  compose.setBridgeResolveFn("eth", (net, ref) => {
    if (ref.startsWith("vm-")) {
      const [vmname, netif = net] = ref.slice(3).split(":");
      const [, mac] = compose.getIPMAC(c, `vm_${vmname}`, netif);
      return mac;
    }
    return undefined;
  });
}

export function annotateVm(c: ComposeFile, opts: YargsInfer<typeof useVmOptions>): void {
  if (!opts["vm-list"]) {
    return;
  }
  for (const s of compose.listByAnnotation(c, "host", (host) => !!opts["vm-list"]![host])) {
    compose.annotate(s, "vmname", opts["vm-list"][compose.annotate(s, "host")!]!);
  }
}

export function* iterVm(c: ComposeFile): Iterable<[s: ComposeService, name: string]> {
  for (const s of compose.listByAnnotation(c, "vmname")) {
    yield [s, compose.annotate(s, "vmname")!];
  }
}
