import path from "node:path";

import type { LinkWithAddressInfo } from "iproute";
import yaml from "js-yaml";
import DefaultMap from "mnemonist/default-map.js";
import { Netmask } from "netmask";
import { flatTransform, pipeline, transform } from "streaming-iterables";
import assert from "tiny-invariant";

import * as compose from "../compose/mod.js";
import { NetDef } from "../netdef/netdef.js";
import type { ComposeFile, ComposeService, N, UERANSIM } from "../types/mod.js";
import { ueransimDockerImage } from "../ueransim/netdef.js";
import { dockerode, file_io, type YargsInfer, type YargsOptions } from "../util/mod.js";

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

export async function loadCtx(args: YargsInfer<typeof ctxOptions>): Promise<[c: ComposeFile, netdef: NetDef]> {
  const c = await file_io.readYAML(path.join(args.dir, "compose.yml")) as ComposeFile;
  const netdef = new NetDef(await file_io.readJSON(args.netdef ?? path.join(args.dir, "netdef.json")) as N.Network);
  netdef.validate();
  return [c, netdef];
}

export const tableOutputOptions = {
  out: {
    defaultDescription: "aligned table on the console",
    desc: "TSV output filename (-.tsv for TSV output on the console)",
    type: "string",
  },
} as const satisfies YargsOptions;

export function tableOutput(args: YargsInfer<typeof tableOutputOptions>, table: file_io.toTable.Result): Promise<void> {
  if (!args.out) {
    return file_io.write("-", table.tui);
  }
  return file_io.write(args.out, table.tsv);
}

export function gatherPduSessions(c: ComposeFile, netdef: NetDef, subscribers: Iterable<NetDef.Subscriber> = netdef.listSubscribers()) {
  return pipeline(
    () => {
      const serviceSubcribers = new DefaultMap<ComposeService, NetDef.Subscriber[]>(() => []);
      for (const sub of subscribers) {
        const ueService = compose.listByAnnotation(c, "ue_supi", (value) => value.split(",").includes(sub.supi))[0];
        assert(ueService, `UE container for ${sub.supi} not found`);
        serviceSubcribers.get(ueService).push(sub);
      }
      return serviceSubcribers;
    },
    transform(16, async ([ueService, subs]) => {
      const ueHost = compose.annotate(ueService, "host") ?? "";
      const ueCt = dockerode.getContainer(ueService.container_name, ueHost);
      const exec = await dockerode.execCommand(ueCt, ["ip", "-j", "addr", "show"]);
      const ueIPs = JSON.parse(exec.stdout) as LinkWithAddressInfo[];
      return { subs, ueService, ueHost, ueCt, ueIPs };
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
        const pduIP = findPduIP(dn, ueIPs, uePDUs);
        if (!pduIP) {
          continue;
        }
        assert(dn);

        const dnService = compose.listByAnnotation(c, "dn", `${dn.snssai}_${dn.dnn}`)[0];
        assert(dnService, `DN container for ${dn.dnn} not found`);
        const dnHost = compose.annotate(dnService, "host") ?? "";
        const dnIP = compose.annotate(dnService, "ip_n6");
        assert(dnIP !== undefined);

        yield { sub, ueService, ueHost, dn, dnService, dnHost, dnIP, pduIP };
      }
    }),
  );
}

function findPduIP(
    dn: N.DataNetwork,
    ipAddr: readonly LinkWithAddressInfo[],
    psList: UERANSIM.PSList | undefined,
): string | undefined {
  if (psList) {
    for (const ps of Object.values(psList)) {
      if (ps.apn === dn.dnn) {
        return ps.address;
      }
    }
  }

  const dnSubnet = new Netmask(dn.subnet!);
  for (const link of ipAddr) {
    const addr = link.addr_info.find((addr) => addr.family === "inet" && dnSubnet.contains(addr.local));
    if (addr) {
      return addr.local;
    }
  }

  return undefined;
}
