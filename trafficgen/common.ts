import path from "node:path";

import { execa } from "execa";
import type { LinkWithAddressInfo } from "iproute";
import assert from "minimalistic-assert";
import { Netmask } from "netmask";
import { type AnyIterable, flatTransform, pipeline, transform } from "streaming-iterables";

import * as compose from "../compose/mod.js";
import { NetDef } from "../netdef/netdef.js";
import type { ComposeFile, N } from "../types/mod.js";
import { dockerode, file_io, type YargsInfer, type YargsOptions } from "../util/mod.js";

export const ctxOptions = {
  dir: {
    demandOption: true,
    desc: "Compose context directory",
    type: "string",
  },
  netdef: {
    defaultDescription: "(--dir)/netdef.json",
    desc: "NetDef filename",
    type: "string",
  },
} as const satisfies YargsOptions;

export async function loadCtx(args: YargsInfer<typeof ctxOptions>): Promise<[c: ComposeFile, netdef: NetDef]> {
  const c = await file_io.readYAML(path.join(args.dir, "compose.yml")) as ComposeFile;
  const netdef = new NetDef(await file_io.readJSON(args.netdef ?? path.join(args.dir, "netdef.json")) as N.Network);
  netdef.validate();
  return [c, netdef];
}

export function gatherPduSessions(c: ComposeFile, netdef: NetDef, subscribers: AnyIterable<NetDef.Subscriber> = netdef.listSubscribers()) {
  return pipeline(
    () => subscribers,
    transform(16, async (sub) => {
      const ueService = compose.listByAnnotation(c, "ue_supi", (value) => value.split(",").includes(sub.supi))[0];
      assert(ueService, `UE container for ${sub.supi} not found`);
      const ueHost = compose.annotate(ueService, "host") ?? "";
      const ct = dockerode.getContainer(ueService.container_name, ueHost);
      const ipAddrs = await dockerode.execCommand(ct, ["ip", "-j", "addr", "show"]);
      const ueIPs = JSON.parse(ipAddrs.stdout) as LinkWithAddressInfo[];
      return { sub, ueService, ueHost, ueIPs };
    }),
    flatTransform(16, function*({ sub, ueService, ueHost, ueIPs }) {
      for (const dnID of sub.subscribedDN) {
        const dn = netdef.findDN(dnID);
        if (!dn?.subnet) {
          continue;
        }
        const dnSubnet = new Netmask(dn.subnet);

        const dnService = compose.listByAnnotation(c, "dn", `${dn.snssai}_${dn.dnn}`)[0];
        assert(dnService, `DN container for ${dn.dnn} not found`);
        const dnHost = compose.annotate(dnService, "host") ?? "";
        const dnIP = compose.annotate(dnService, "ip_n6");
        assert(dnIP !== undefined);

        const pduIP = ueIPs.flatMap((link) => {
          const addr = link.addr_info.find((addr) => addr.family === "inet" && dnSubnet.contains(addr.local));
          return addr ?? [];
        })[0];
        if (!pduIP) {
          continue;
        }
        yield { sub, ueService, ueHost, dn, dnService, dnHost, dnIP, pduIP: pduIP.local };
      }
    }),
  );
}

export const cmdOptions = {
  cmdout: {
    desc: "save command line to file",
    type: "string",
  },
} as const satisfies YargsOptions;

export async function cmdOutput(args: YargsInfer<typeof cmdOptions>, lines: Iterable<string>): Promise<void> {
  const script = [
    "#!/bin/bash",
    ...compose.scriptHead,
    ...lines,
  ].join("\n");

  if (args.cmdout) {
    await file_io.write(args.cmdout, script);
  } else {
    const result = await execa("bash", ["-c", script], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      reject: false,
    });
    process.exitCode = result.exitCode;
  }
}
