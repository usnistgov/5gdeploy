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

  /** Normalize data path link as object form. */
  export function normalizeDataPathLink(link: N.DataPathLink): N.DataPathLink.Object {
    if (Array.isArray(link)) {
      return { a: link[0], b: link[1] };
    }
    return link;
  }
}
