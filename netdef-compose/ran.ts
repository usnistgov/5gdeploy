import fs from "node:fs/promises";

import yaml from "js-yaml";

import type { NetDef } from "../netdef/netdef.js";
import { IPMAP } from "../phoenix-config/ipmap.js";
import type { ComposeFile, ComposeService } from "../types/compose.js";
import type * as N from "../types/netdef.js";
import { type NetDefComposeContext } from "./context.js";

/** Contextual information for RANServiceGen. */
export interface RANServiceGenContext {
  /** Network definition. */
  readonly netdef: NetDef;
  /** Network definition. */
  readonly network: N.Network;
  /** Compose file with core services pre-filled. */
  c: ComposeFile;
}

/** Parameter generator for a RAN service. */
export interface RANServiceGen {
  /**
   * Generate parameter for a gNB.
   * @param ctx contextual information.
   * @param gnb gNB definition.
   * @param s Compose service with networks pre-filled.
   */
  gnb(ctx: RANServiceGenContext, gnb: N.GNB, s: ComposeService): void;

  /**
   * Generate parameter for a UE.
   * @param ctx contextual information.
   * @param subscriber subscriber definition.
   * @param s Compose service with networks pre-filled.
   */
  ue(ctx: RANServiceGenContext, subscriber: N.Subscriber, s: ComposeService): void;
}

const ueransim: RANServiceGen = {
  gnb({ netdef, network, c }, gnb, s) {
    s.environment = {
      PLMN: network.plmn,
      NCI: gnb.nci,
      GNBIDLEN: network.gnbIdLength.toString(),
      TAC: network.tac,
      LINK_IP: s.networks.air!.ipv4_address,
      NGAP_IP: s.networks.n2!.ipv4_address,
      GTP_IP: s.networks.n3!.ipv4_address,
      AMF_IPS: network.amfs.map((amf) => c.services[amf.name]!.networks.n2!.ipv4_address).join(","),
      SLICES: netdef.nssai.join(","),
    };
  },
  ue({ network, c }, subscriber, s) {
    const allGNBs = network.gnbs.map((gnb) => gnb.name);
    const slices = new Set<string>();
    const sessions = new Set<string>();
    for (const { snssai, dnns } of (subscriber.requestedNSSAI ?? subscriber.subscribedNSSAI ?? [])) {
      slices.add(snssai);
      for (const dnn of dnns) {
        sessions.add(`${dnn}:${snssai}`);
      }
    }
    s.environment = {
      PLMN: network.plmn,
      IMSI: subscriber.supi,
      KEY: subscriber.k,
      OPC: subscriber.opc,
      GNB_IPS: (subscriber.gnbs ?? allGNBs).map(
        (name) => c.services[name]!.networks.air!.ipv4_address,
      ).join(","),
      SLICES: [...slices].join(","),
      SESSIONS: [...sessions].join(","),
    };
  },
};

/** Parameter generators for RAN services, by container image name suffix. */
export const RANServiceGens: Record<string, RANServiceGen> = {
  ueransim,
};

/** Topology generators for RAN services. */
export const RANProviders: Record<string, (ctx: NetDefComposeContext) => Promise<void>> = {
  ueransim: wrapRANProvider(ueransim, "docker/ueransim/compose.phoenix.yml"),
};

function wrapRANProvider(sg: RANServiceGen, composeFile: string): (ctx: NetDefComposeContext) => Promise<void> {
  let ranCompose: ComposeFile | undefined;
  return async (ctx: NetDefComposeContext) => {
    ranCompose ??= yaml.load(await fs.readFile(composeFile, "utf8")) as ComposeFile;
    ctx.defineNetwork("air");
    for (const [ct, gnb] of IPMAP.suggestNames("gnb", ctx.network.gnbs)) {
      const service = ctx.defineService(ct, "", ["air", "n2", "n3"]);
      copyComposeServiceFields(service, ranCompose.services.gnb!);
      sg.gnb(ctx, gnb, service);
    }
    for (const [ct, ue] of IPMAP.suggestNames("ue", ctx.network.subscribers)) {
      const service = ctx.defineService(ct, "", ["air"]);
      copyComposeServiceFields(service, ranCompose.services.ue!);
      sg.ue(ctx, ue, service);
    }
  };
}

function copyComposeServiceFields(dst: ComposeService, src: ComposeService): void {
  for (const [key, value] of Object.entries(src)) {
    if (!["container_name", "hostname", "networks"].includes(key)) {
      (dst as any)[key] = JSON.parse(JSON.stringify(value));
    }
  }
}
