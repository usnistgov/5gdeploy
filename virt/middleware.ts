import path from "node:path";

import type { WritableDeep } from "type-fest";

import * as compose from "../compose/mod.js";
import type { ComposeFile } from "../types/mod.js";
import { assert, file_io, type YargsInfer, type YargsOptions } from "../util/mod.js";
import { iterVM } from "./helper.js";

/** Yargs options definition for placing Compose services onto virtual machines. */
export const useVmOptions = {
  "use-vm": {
    desc: "Compose context for virtual machines recognized in --place and --bridge flags",
    normalize: true,
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
 * This is achieved by defining an SSH URI for the "vm-upf1" host.
 *
 * In a --bridge flag for Ethernet bridge, a VM interface can be referred as "vm-name" or "vm-name:netif".
 * "netif" defaults for the bridge network name.
 * This is achieved by performing regex replacements on bridge flags.
 */
export async function useVm(args: YargsInfer<typeof useVmOptions> &
WritableDeep<YargsInfer<typeof compose.placeOptions> & YargsInfer<typeof compose.bridgeOptions>>,
) {
  if (!args["use-vm"]) {
    return;
  }
  const c = await file_io.readYAML(path.join(args["use-vm"], "compose.yml")) as ComposeFile;

  for (const [s, name] of iterVM(c)) {
    const ip = compose.getIP(s, "vmctrl");
    (args["ssh-uri"] ??= {})[`vm-${name}`] = `root@${ip}`;
  }

  args.bridge = Array.from(args.bridge ?? [], (line) => {
    if (!line.includes(",eth,")) {
      return line;
    }

    const net = line.split(",", 2)[0]!;
    return line.replaceAll(/=vm-(\w+)(?::(\w+))?/g, (str, name: string, netif = net) => {
      void str;
      const s = c.services[`vm_${name}`];
      assert(s, `VM ${name} not found in eth bridge`);
      const [, mac] = compose.getIPMAC(s, netif);
      return `=${mac}`;
    });
  });
}
