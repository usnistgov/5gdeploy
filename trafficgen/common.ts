import path from "node:path";

import type { LinkWithAddressInfo } from "iproute";
import * as yaml from "js-yaml";
import { Netmask } from "netmask";
import { flatTransform, pipeline } from "streaming-iterables";
import type { ReadonlyDeep } from "type-fest";

import { compose, netdef } from "../netdef-compose/mod.js";
import { prushDockerImage, prushSupiToMsin } from "../packetrusher/ran.js";
import type { ComposeFile, ComposeService, N, UERANSIM } from "../types/mod.js";
import { ueransimDockerImage } from "../ueransim/ran.js";
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
 * @param opts - Parsed {@link ctxOptions}.
 * @returns Compose context and NetDef.
 */
export async function loadCtx(opts: YargsInfer<typeof ctxOptions>): Promise<[c: ComposeFile, network: N.Network]> {
  const c = await file_io.readYAML(path.join(opts.dir, "compose.yml")) as ComposeFile;
  const network = await file_io.readJSON(opts.netdef ?? path.join(opts.dir, "netdef.json"));
  netdef.validate(network);
  return [c, network];
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
 * @param opts - Parsed {@link tableOutputOptions}.
 * @param table - Table prepared by {@link file_io.toTable}.
 */
export function tableOutput(opts: YargsInfer<typeof tableOutputOptions>, table: file_io.toTable.Result): Promise<void> {
  if (!opts.out) {
    return file_io.write("-", table.tui);
  }
  return file_io.write(opts.out, table.tsv);
}

export function gatherPduSessions(c: ComposeFile, network: N.Network) {
  const subscribers = new Map<string, netdef.Subscriber>();
  for (const sub of netdef.listSubscribers(network)) {
    subscribers.set(sub.supi, sub);
  }

  return pipeline(
    () => compose.listByAnnotation(c, "ue_supi"),
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
        const dn = netdef.findDN(network, dnID);
        if (!dn.subnet) {
          continue;
        }
        const pduSess = findPduIP(sub, ueService, dn, ueIPs, uePDUs);
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
    { supi }: netdef.Subscriber,
    { image }: ComposeService,
    { dnn, subnet }: N.DataNetwork,
    ipAddr: readonly LinkWithAddressInfo[],
    psList: UERANSIM.PSList | undefined,
): [ip: string, netif: string] | undefined {
  let ueSubnet = new Netmask(subnet!);
  if (psList) {
    for (const ps of Object.values(psList)) {
      if (ps.apn === dnn && !!ps.address) {
        ueSubnet = new Netmask(`${ps.address}/32`);
      }
    }
  } else if (image === prushDockerImage) {
    ipAddr = ipAddr.filter(({ ifname }) => ifname === `val${prushSupiToMsin(supi)}`);
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
export function copyPlacementNetns(target: ComposeService, source: ReadonlyDeep<ComposeService>): void {
  compose.annotate(target, "host", compose.annotate(source, "host") ?? "");
  target.cpuset = source.cpuset;
  target.network_mode = `container:${source.container_name}`;
}

/** Derive NFD service name. */
export function toNfdName({ container_name: ct }: ReadonlyDeep<ComposeService>): string {
  return ct.replace(compose.nameToNf(ct), "nfd");
}
