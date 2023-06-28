import assert from "minimalistic-assert";

import type * as T from "../types/netdef.js";

/** 5G network definition model. */
export class NetDef {
  constructor(public network: T.Network) {}

  /** Return Tracking Area Code (TAC). */
  public get tac(): number {
    assert(/^[\da-f]{4}$/.test(this.network.tac));
    return Number.parseInt(this.network.tac, 16);
  }

  /** Split NR Cell Global Identifier as gNB ID and Cell ID. */
  public splitNCGI(ncgi: string): NetDef.NCGI {
    assert(/^[\da-f]{9}$/i.test(ncgi));
    const n = BigInt(Number.parseInt(ncgi, 16));
    const cellIdLength = BigInt(36 - this.network.gnbIdLength);
    return {
      gnb: Number(n >> cellIdLength),
      cell: Number(n & ((1n << cellIdLength) - 1n)),
      ncgi: Number(n),
    };
  }

  /** Find gNB by short name. */
  public findGNB(name: string): T.GNB | undefined {
    return this.network.gnbs.find((gnb) => gnb.name === name);
  }

  /** Find UPF by short name. */
  public findUPF(name: string): T.UPF | undefined {
    return this.network.upfs.find((upf) => upf.name === name);
  }
}
export namespace NetDef {
  /** Split PLMN to MCC and MNC. */
  export function splitPLMN(plmn: T.PLMN): [mcc: string, mnc: string] {
    assert(/^\d{3}-\d{2,3}$/.test(plmn));
    return plmn.split("-") as [string, string];
  }

  /** NR Cell Global Identifier components. */
  export interface NCGI {
    gnb: number;
    cell: number;
    ncgi: number;
  }

  /** Split S-NSSAI to sst and sd. */
  export function splitSNSSAI(snssai: T.SNSSAI): [sst: string] | [sst: string, sd: string] {
    assert(/^[\da-f]{2}(?:[\da-f]{6})?$/.test(snssai));
    if (snssai.length === 2) {
      return [snssai];
    }
    return [snssai.slice(0, 2), snssai.slice(2)];
  }

  /** Normalize data path link as object form. */
  export function normalizeDataPathLink(link: T.DataPathLink): T.DataPathLink.Object {
    if (Array.isArray(link)) {
      return { a: link[0], b: link[1] };
    }
    return link;
  }
}
