import type { NetDef } from "../netdef/netdef.js";
import type { ComposeFile, ComposeService } from "../types/compose.js";
import type * as N from "../types/netdef.js";

/** Contextual information for RANServiceGen. */
export interface RANServiceGenContext {
  /** Network definition. */
  readonly netdef: NetDef;
  /** Network definition. */
  readonly network: N.Network;
  /** Compose file with core services pre-filled. */
  compose: ComposeFile;
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
  gnb({ netdef, network, compose }, gnb, s) {
    s.environment = {
      PLMN: network.plmn,
      NCI: gnb.nci,
      GNBIDLEN: network.gnbIdLength.toString(),
      TAC: network.tac,
      LINK_IP: s.networks.air!.ipv4_address,
      NGAP_IP: s.networks.n2!.ipv4_address,
      GTP_IP: s.networks.n3!.ipv4_address,
      AMF_IPS: network.amfs.map((amf) => compose.services[amf.name]!.networks.n2!.ipv4_address).join(","),
      SLICES: netdef.nssai.join(","),
    };
  },
  ue({ network, compose }, subscriber, s) {
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
        (name) => compose.services[name]!.networks.air!.ipv4_address,
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
