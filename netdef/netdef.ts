import { AggregateAjvError } from "@segment/ajv-human-errors";
import Ajv from "ajv";
import assert from "minimalistic-assert";
import type { SetRequired } from "type-fest";
import { arr2hex, randomBytes } from "uint8-util";

import type * as N from "../types/netdef.js";
import netdefSchema from "../types/netdef.schema.json";

export type { N };

const validate = new Ajv({
  allErrors: true,
  verbose: true,
}).compile(netdefSchema);

/** Validate against schema. */
export function validateNetDef(network: N.Network): void {
  const valid = validate(network);
  if (!valid) {
    throw new AggregateAjvError(validate.errors!);
  }
}

/** 5G network definition model. */
export class NetDef {
  constructor(public network: N.Network) {}

  /** Validate against schema. */
  public validate(): void {
    validateNetDef(this.network);
  }

  /** Return Tracking Area Code (TAC) as int. */
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

  /**
   * Iterate over subscribers.
   * @param expandCount if true, emit .count>1 entry as multiple entries.
   */
  public listSubscribers(expandCount = true): NetDef.Subscriber[] {
    this.network.subscriberDefault ??= {};
    this.network.subscriberDefault.k ??= arr2hex(randomBytes(16));
    this.network.subscriberDefault.opc ??= arr2hex(randomBytes(16));
    const dfltSubscribedNSSAI = this.nssai.map((snssai): N.SubscriberSNSSAI => ({
      snssai,
      dnns: this.network.dataNetworks.filter((dn) => dn.snssai === snssai).map((dn) => dn.dnn),
    }));
    const allGNBs = this.network.gnbs.map((gnb) => gnb.name);

    const list: NetDef.Subscriber[] = [];
    for (const subscriber of this.network.subscribers) {
      const sub: NetDef.Subscriber = {
        count: 1,
        k: this.network.subscriberDefault.k,
        opc: this.network.subscriberDefault.opc,
        subscribedNSSAI: dfltSubscribedNSSAI,
        gnbs: allGNBs,
        ...subscriber,
        subscribedDN: [],
        requestedDN: [],
      };
      assert(sub.count >= 1);

      for (const { snssai, dnns } of sub.subscribedNSSAI) {
        for (const dnn of dnns) {
          sub.subscribedDN.push({ snssai, dnn });
        }
      }

      if (sub.requestedNSSAI) {
        for (const { snssai, dnns } of sub.requestedNSSAI) {
          for (const dnn of dnns) {
            sub.requestedDN.push({ snssai, dnn });
          }
        }
      } else {
        sub.requestedDN.push(...sub.subscribedDN);
      }

      if (expandCount && sub.count > 1) {
        let supi = BigInt(sub.supi);
        for (let i = 0; i < sub.count; ++i) {
          list.push({ ...sub, supi: supi.toString().padStart(15, "0"), count: 1 });
          ++supi;
        }
      } else {
        list.push(sub);
      }
    }
    return list;
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

  /** Gather N3,N9,N6 peers of a UPF. */
  public gatherUPFPeers(upf: N.UPF): NetDef.UPFPeers {
    const peers: NetDef.UPFPeers = {
      N3: [],
      N9: [],
      N6Ethernet: [],
      N6IPv4: [],
      N6IPv6: [],
    };
    for (const [peer, cost] of this.listDataPathPeers(upf.name)) {
      if (typeof peer === "string") {
        const gnb = this.findGNB(peer);
        if (gnb) {
          peers.N3.push(gnb);
          continue;
        }

        const upf = this.findUPF(peer);
        if (upf) {
          peers.N9.push(upf);
          continue;
        }

        assert(false, `missing peer ${peer}`);
      }

      const dn = this.findDN(peer);
      assert(!!dn, `missing peer ${JSON.stringify(peer)}`);
      peers[`N6${dn.type}`].push({
        ...dn,
        index: this.network.dataNetworks.indexOf(dn),
        cost,
      });
    }
    return peers;
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

  /** S-NSSAI components. */
  export interface SNSSAI {
    hex: {
      sst: string;
      sd?: string;
    };
    int: {
      sst: number;
      sd?: number;
    };
  }

  /** Information about a subscriber. */
  export interface Subscriber extends SetRequired<N.Subscriber, "count" | "k" | "opc" | "subscribedNSSAI" | "gnbs"> {
    subscribedDN: N.DataNetworkID[];
    requestedDN: N.DataNetworkID[];
  }

  /** N3,N9,N6 peers of a UPF. */
  export interface UPFPeers {
    N3: N.GNB[];
    N9: N.UPF[];
    N6Ethernet: UPFN6Peer[];
    N6IPv4: UPFN6Peer[];
    N6IPv6: UPFN6Peer[];
  }

  /** N6 peer of a UPF. */
  export interface UPFN6Peer extends N.DataNetwork {
    index: number;
    cost: number;
  }

  /** Split S-NSSAI to sst and sd. */
  export function splitSNSSAI(snssai: N.SNSSAI): SNSSAI {
    assert(/^[\da-f]{2}(?:[\da-f]{6})?$/i.test(snssai));
    if (snssai.length === 2) {
      return {
        hex: { sst: snssai },
        int: { sst: Number.parseInt(snssai, 16) },
      };
    }
    const sst = snssai.slice(0, 2);
    const sd = snssai.slice(2);
    return {
      hex: { sst, sd },
      int: { sst: Number.parseInt(sst, 16), sd: Number.parseInt(sd, 16) },
    };
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
