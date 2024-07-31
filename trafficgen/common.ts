import path from "node:path";

import type { LinkWithAddressInfo } from "iproute";
import yaml from "js-yaml";
import { Netmask } from "netmask";
import { flatTransform, pipeline } from "streaming-iterables";

import * as compose from "../compose/mod.js";
import { NetDef } from "../netdef/netdef.js";
import type { ComposeFile, ComposeService, N, UERANSIM } from "../types/mod.js";
import { ueransimDockerImage } from "../ueransim/netdef.js";
import { assert, dockerode, file_io, type YargsInfer, type YargsOptions } from "../util/mod.js";

/** Yargs options `--dir` and `--netdef`. */
export const ctxOptions = {
  dir: {
    demandOption: true,
    desc: "Compose context directory",
    normalize: true,
    type: "string",
  },
  netdef: {
    defaultDescription: "(--dir)/netdef.json",
    desc: "NetDef filename",
    normalize: true,
    type: "string",
  },
} as const satisfies YargsOptions;

/**
 * Load Compose context and NetDef.
 * @param args - Parsed {@link ctxOptions}.
 * @returns - Compose context and NetDef.
 */
export async function loadCtx(args: YargsInfer<typeof ctxOptions>): Promise<[c: ComposeFile, netdef: NetDef]> {
  const c = await file_io.readYAML(path.join(args.dir, "compose.yml")) as ComposeFile;
  const netdef = new NetDef(await file_io.readJSON(args.netdef ?? path.join(args.dir, "netdef.json")) as N.Network);
  netdef.validate();
  return [c, netdef];
}

/** Yargs options `--out` for tabular output. */
export const tableOutputOptions = {
  out: {
    defaultDescription: "aligned table on the console",
    desc: "TSV output filename (-.tsv for TSV output on the console)",
    type: "string",
  },
} as const satisfies YargsOptions;

/**
 * Print a table or write to TSV file.
 * @param args - Parsed {@link tableOutputOptions}.
 * @param table - Table prepared by {@link file_io.toTable}.
 */
export function tableOutput(args: YargsInfer<typeof tableOutputOptions>, table: file_io.toTable.Result): Promise<void> {
  if (!args.out) {
    return file_io.write("-", table.tui);
  }
  return file_io.write(args.out, table.tsv);
}

export function gatherPduSessions(c: ComposeFile, netdef: NetDef) {
  const subscribers = new Map<string, NetDef.Subscriber>();
  for (const sub of netdef.listSubscribers()) {
    subscribers.set(sub.supi, sub);
  }

  return pipeline(
    () => compose.listByAnnotation(c, "ue_supi", () => true),
    flatTransform(16, async function*(ueService) {
      const subs = Array.from(
        compose.annotate(ueService, "ue_supi")!.split(","),
        (supi) => subscribers.get(supi)!,
      );

      const ueHost = compose.annotate(ueService, "host") ?? "";
      const ueCt = dockerode.getContainer(ueService.container_name, ueHost);
      try {
        const exec = await dockerode.execCommand(ueCt, ["ip", "-j", "addr", "show"]);
        const ueIPs = JSON.parse(exec.stdout) as LinkWithAddressInfo[];
        yield { subs, ueService, ueHost, ueCt, ueIPs };
      } catch {}
    }),
    flatTransform(16, async function*({ subs, ueService, ueHost, ueCt, ueIPs }) {
      yield* await Promise.all(Array.from(subs, async (sub) => {
        let uePDUs: UERANSIM.PSList | undefined;
        if (ueService.image === ueransimDockerImage) {
          const psList = await dockerode.execCommand(ueCt, ["./nr-cli", `imsi-${sub.supi}`, "-e", "ps-list"]);
          uePDUs = yaml.load(psList.stdout) as UERANSIM.PSList;
        }
        return { sub, ueService, ueHost, ueIPs, uePDUs };
      }));
    }),
    flatTransform(16, function*({ sub, ueService, ueHost, ueIPs, uePDUs }) {
      for (const dnID of sub.subscribedDN) {
        const dn = netdef.findDN(dnID);
        if (!dn?.subnet) {
          continue;
        }
        const pduSess = findPduIP(dn, ueIPs, uePDUs);
        if (!pduSess) {
          continue;
        }
        const [pduIP, pduNetif] = pduSess;

        const dnService = compose.listByAnnotation(c, "dn", `${dn.snssai}_${dn.dnn}`)[0];
        assert(dnService, `DN container for ${dn.dnn} not found`);
        const dnHost = compose.annotate(dnService, "host") ?? "";
        const dnIP = compose.getIP(dnService, "n6");
        assert(dnIP !== undefined);

        yield { sub, ueService, ueHost, dn, dnService, dnHost, dnIP, pduIP, pduNetif };
      }
    }),
  );
}

function findPduIP(
    dn: N.DataNetwork,
    ipAddr: readonly LinkWithAddressInfo[],
    psList: UERANSIM.PSList | undefined,
): [ip: string, netif: string] | undefined {
  let ueSubnet = new Netmask(dn.subnet!);
  if (psList) {
    for (const ps of Object.values(psList)) {
      if (ps.apn === dn.dnn && !!ps.address) {
        ueSubnet = new Netmask(`${ps.address}/32`);
      }
    }
  }

  for (const link of ipAddr) {
    const addr = link.addr_info.find((addr) => addr.family === "inet" && ueSubnet.contains(addr.local));
    if (addr) {
      return [addr.local, link.ifname];
    }
  }

  return undefined;
}

/** Copy host, cpuset, join network namespace. */
export function copyPlacementNetns(target: ComposeService, source: ComposeService): void {
  compose.annotate(target, "host", compose.annotate(source, "host") ?? "");
  target.cpuset = source.cpuset;
  target.network_mode = `service:${source.container_name}`;
}
