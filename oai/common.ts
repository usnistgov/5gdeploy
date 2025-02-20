import path from "node:path";

import { execa } from "execa";
import stringify from "json-stringify-deterministic";

import { compose, netdef } from "../netdef-compose/mod.js";
import type { CN5G, N } from "../types/mod.js";
import { file_io } from "../util/mod.js";
import type { OAIOpts } from "./options.js";

export const convertCommand = path.join(import.meta.dirname, "libconf_convert.py");

/** Determine OAI Docker image name with version tag. */
export async function getTaggedImageName(opts: OAIOpts, nf: string): Promise<string> {
  let tagOpt = opts["oai-cn5g-tag"];
  let filename = "docker-compose-slicing-basic-nrf.yaml";
  let image = `oaisoftwarealliance/oai-${nf}`;
  let dfltTag = "latest";
  switch (nf) {
    case "pcf":
    case "upf-vpp": {
      filename = "docker-compose-basic-vpp-pcf-ulcl.yaml";
      break;
    }
    case "ue": {
      image = "oaisoftwarealliance/oai-nr-ue";
      // fallthrough
    }
    case "gnb": {
      tagOpt = opts["oai-ran-tag"];
      filename = "docker-compose-slicing-ransim.yaml";
      dfltTag = "develop";
      break;
    }
  }

  if (tagOpt) {
    return `${image}:${tagOpt}`;
  }
  return await compose.getTaggedImageName(path.resolve(import.meta.dirname, "fed", filename), image) ?? `${image}:${dfltTag}`;
}

/**
 * Load OAI config from libconfig file.
 * @param filename - Either a libconfig filename or a directory name.
 * @param ct - If `filename` refers to a directory, use `${ct}.conf` in the directory.
 * @returns File content converted to JSON.
 */
export async function loadLibconf<T extends {}>(filename: string, ct?: string): Promise<T & { save: () => Promise<string> }> {
  let body = await file_io.readText(await file_io.resolveFilenameInDirectory(filename, ct, ".conf"));
  body = body.replaceAll(/=\s*0+(\d+)\b/g, "= $1");

  const subprocess = await execa("python3", [convertCommand, "conf2json", path.basename(filename)], {
    cwd: path.dirname(filename),
    input: body,
    stdout: "pipe",
    stderr: "inherit",
  });
  const c = JSON.parse(subprocess.stdout);
  Object.defineProperty(c, "save", {
    configurable: true,
    enumerable: false,
    value: saveLibconf,
  });
  return c;
}

/** Save OAI config `this` to libconfig string. */
async function saveLibconf(this: unknown): Promise<string> {
  const subprocess = await execa("python3", [convertCommand, "json2conf"], {
    input: stringify(this),
    stdout: "pipe",
    stderr: "inherit",
  });
  return subprocess.stdout;
}

/** Construct DNAI and FQDN/NWI for UPF or Data Network. */
export function makeDnaiFqdn(item: N.UPF | N.DataNetwork, { mcc, mnc }: netdef.PLMN): [dnai: string, fqdn: string] {
  const [name, subdomain] = "dnn" in item ? [item.dnn, ""] : [item.name, ".node"];
  const cleanName = name.toLowerCase().replaceAll(/[^\da-z]/gi, "-").replaceAll(/^-|-$/g, "");
  return [cleanName, `${cleanName}${subdomain}.5gcn.mnc${mnc}.mcc${mcc}.${makeDnaiFqdn.realm}`];
}
export namespace makeDnaiFqdn {
  export const realm = "3gppnetwork.org";
  export const access = "access.oai.org";
  export const core = "core.oai.org";
}

/** Construct sNssaiUpfInfoList. */
export function makeSUIL(
    network: N.Network,
    peers: netdef.UPF.Peers,
    { sdFilled = false, withDnai = false }: makeSUIL.Options = {},
): CN5G.upf.SNSSAIInfo[] {
  const plmn = netdef.splitPLMN(network.plmn);
  const dnaiN39: Record<string, string> = Object.fromEntries(
    Array.from(peers.N9, (peer) => makeDnaiFqdn(peer, plmn)),
  );
  if (peers.N3.length > 0) {
    dnaiN39.access = makeDnaiFqdn.access;
  }

  const dnnInfos: Array<CN5G.upf.DNNInfo & { snssai: N.SNSSAI }> = [];
  for (const dn of network.dataNetworks) {
    const hasN6 = peers.N6IPv4.some((peer) => peer.dnn === dn.dnn);
    if (dn.type !== "IPv4" || !(hasN6 || withDnai)) {
      continue;
    }

    const di: CN5G.upf.DNNInfo = { dnn: dn.dnn };
    if (withDnai) {
      di.dnaiNwInstanceList = {
        ...dnaiN39,
      };
      if (hasN6) {
        const [dnai, nwi] = makeDnaiFqdn(dn, plmn);
        di.dnaiNwInstanceList[dnai] = nwi;
      }
      di.dnaiList = Object.keys(di.dnaiNwInstanceList);
    }
    dnnInfos.push({ snssai: dn.snssai, ...di });
  }

  return Array.from(
    Map.groupBy(dnnInfos, (di) => di.snssai),
    ([snssai, dis]) => ({
      sNssai: netdef.splitSNSSAI(snssai, sdFilled).ih,
      dnnUpfInfoList: Array.from(dis, ({ snssai, ...di }) => {
        void snssai;
        return di;
      }),
    }),
  );
}
export namespace makeSUIL {
  export interface Options {
    sdFilled?: boolean;
    withDnai?: boolean;
  }
}
