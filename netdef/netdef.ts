import assert from "minimalistic-assert";

import type * as N from "../types/netdef.js";

/** 5G network definition model. */
export class NetDef {
  constructor(public network: N.Network) {}

  /** Return Tracking Area Code (TAC). */
  public get tac(): number {
    assert(/^[\da-f]{6}$/i.test(this.network.tac));
    return Number.parseInt(this.network.tac, 16);
  }

  /** Return all unique S-NSSAIs. */
  public get nssai(): N.SNSSAI[] {
    return [...new Set(Array.from(this.network.dataNetworks, (dn) => dn.snssai))];
  }

  /** Return normalized data path links. */
  public get dataPathLinks(): Array<Required<N.DataPathLink.Object>> {
    return Array.from(this.network.dataPaths.links, (link) => NetDef.normalizeDataPathLink(link));
  }

  /** Split NR Cell Identity (NCI) as gNB ID and Cell ID. */
  public splitNCI(nci: string): NetDef.NCI {
    assert(/^[\da-f]{9}$/i.test(nci));
    const n = BigInt(Number.parseInt(nci, 16));
    const cellIdLength = BigInt(36 - this.network.gnbIdLength);
    return {
      gnb: Number(n >> cellIdLength),
      cell: Number(n & ((1n << cellIdLength) - 1n)),
      nci: Number(n),
    };
  }

  /** Find gNB by short name. */
  public findGNB(name: string): N.GNB | undefined {
    return this.network.gnbs.find((gnb) => gnb.name === name);
  }

  /** Find UPF by short name. */
  public findUPF(name: string): N.UPF | undefined {
    return this.network.upfs.find((upf) => upf.name === name);
  }

  /** Find Data Network by dnn and optional snssai. */
  public findDN(dnn: string, snssai?: string): N.DataNetwork | undefined;
  public findDN(id: N.DataNetworkID): N.DataNetwork | undefined;
  public findDN(dnn: N.DataNetworkID | string, snssai?: string): N.DataNetwork | undefined {
    if (typeof dnn !== "string") {
      return this.findDN(dnn.dnn, dnn.snssai);
    }
    return this.network.dataNetworks.find((dn) => dn.dnn === dnn && (snssai === undefined || dn.snssai === snssai));
  }

  /** Iterate over peers of a data path node. */
  public *listDataPathPeers(self: N.DataPathNode): Iterable<[peer: N.DataPathNode, cost: number]> {
    for (const link of this.network.dataPaths.links) {
      const { a, b, cost = 1 } = NetDef.normalizeDataPathLink(link);
      if (NetDef.equalDataPathNode(self, a)) {
        yield [b, cost];
      } else if (NetDef.equalDataPathNode(self, b)) {
        yield [a, cost];
      }
    }
  }

  /** Iterate over requested or subscribed data networks. */
  public *listSubscriberDNs(subscriber: N.Subscriber, requested?: boolean): Iterable<N.DataNetworkID> {
    const nssai = (requested ? subscriber.requestedNSSAI : undefined) ?? subscriber.subscribedNSSAI;
    if (nssai) {
      for (const { snssai, dnns } of nssai) {
        for (const dnn of dnns) {
          yield { snssai, dnn };
        }
      }
    } else {
      yield* this.network.dataNetworks;
    }
  }
}
export namespace NetDef {
  /** Split PLMN to MCC and MNC. */
  export function splitPLMN(plmn: N.PLMN): [mcc: string, mnc: string] {
    assert(/^\d{3}-\d{2,3}$/.test(plmn));
    return plmn.split("-") as [string, string];
  }

  /** NR Cell Identity components. */
  export interface NCI {
    gnb: number;
    cell: number;
    nci: number;
  }

  /** Split S-NSSAI to sst and sd. */
  export function splitSNSSAI(snssai: N.SNSSAI): [sst: string] | [sst: string, sd: string] {
    assert(/^[\da-f]{2}(?:[\da-f]{6})?$/i.test(snssai));
    if (snssai.length === 2) {
      return [snssai];
    }
    return [snssai.slice(0, 2), snssai.slice(2)];
  }

  /** Validate AMF Identifier. */
  export function validateAMFI(amfi: N.AMFI): N.AMFI {
    const [region, set, pointer] = amfi;
    assert(Number.isInteger(region) && region >= 0 && region <= 0b11111111);
    assert(Number.isInteger(set) && set >= 0 && set <= 0b1111111111);
    assert(Number.isInteger(pointer) && pointer >= 0 && pointer <= 0b111111);
    return amfi;
  }

  /** Determine equality of two DataPathNodes. */
  export function equalDataPathNode(a: N.DataPathNode, b: N.DataPathNode): boolean {
    if (typeof a === "string" && typeof b === "string") {
      return a === b;
    }
    if (typeof a === "object" && typeof b === "object") {
      return a.snssai === b.snssai && a.dnn === b.dnn;
    }
    return false;
  }

  /** Normalize data path link as object form. */
  export function normalizeDataPathLink(link: N.DataPathLink): Required<N.DataPathLink.Object> {
    if (Array.isArray(link)) {
      return { a: link[0], b: link[1], cost: 1 };
    }
    return { cost: 1, ...link };
  }
}
