import { AggregateAjvError } from "@segment/ajv-human-errors";
import Ajv from "ajv";
import assert from "minimalistic-assert";
import type { SetRequired } from "type-fest";
import { arr2hex, randomBytes } from "uint8-util";

import type { N } from "../types/mod.js";
import netdefSchema from "../types/netdef.schema.json";

const validate = new Ajv({
  allErrors: true,
  verbose: true,
}).compile(netdefSchema);

/** Validate NetDef object against JSON schema. */
export function validateNetDef(network: N.Network): void {
  const valid = validate(network);
  if (!valid) {
    throw new AggregateAjvError(validate.errors!);
  }
}

function formatSUPI(value: bigint): string {
  return value.toString(10).padStart(15, "0");
}

/** 5G network definition model. */
export class NetDef {
  constructor(public network: N.Network) {}

  /** Validate against schema. */
  public validate(): void {
    validateNetDef(this.network);
  }

  /** Return Tracking Area Code (TAC) as integer. */
  public get tac(): number {
    assert(/^[\da-f]{6}$/i.test(this.network.tac));
    return Number.parseInt(this.network.tac, 16);
  }

  /** Return all unique S-NSSAIs. */
  public get nssai(): N.SNSSAI[] {
    return [...new Set(Array.from(this.network.dataNetworks, (dn) => dn.snssai))];
  }

  /** Return all AMFs. */
  public get amfs(): Array<Required<N.AMF>> {
    let { amfs } = this.network;
    if (!amfs?.length) {
      amfs = [{ name: "amf" }];
    }
    const nssai = this.nssai;
    return amfs.map((amf, i) => {
      const result: Required<N.AMF> = {
        name: `amf${i}`,
        amfi: [1, i, 0],
        nssai,
        ...amf,
      };
      for (const [i, bits] of [8, 10, 6].entries()) {
        const n = result.amfi[i]!;
        assert(Number.isInteger(n) && n >= 0 && n < (1 << bits), "invalid AMFI");
      }
      return result;
    });
  }

  /** Return all SMFs. */
  public get smfs(): Array<Required<N.SMF>> {
    let { smfs } = this.network;
    if (!smfs?.length) {
      smfs = [{ name: "smf" }];
    }
    const nssai = this.nssai;
    return smfs.map((smf, i) => ({
      name: `smf${i}`,
      nssai,
      ...smf,
    }));
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
   * @param expandCount - If true, emit each `.count>1` entry as multiple entries.
   */
  public listSubscribers({ expandCount = true }: NetDef.ListSubscribersOptions = {}): NetDef.Subscriber[] {
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
        supiLast: subscriber.supi,
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

      let supiN = BigInt(sub.supi);
      if (expandCount && sub.count > 1) {
        for (let i = 0; i < sub.count; ++i) {
          const supi = formatSUPI(supiN++);
          list.push({ ...sub, supi, supiLast: supi, count: 1 });
        }
      } else {
        sub.supiLast = formatSUPI(supiN + BigInt(sub.count - 1));
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
    ih: {
      sst: number;
      sd?: string;
    };
  }

  /** {@link NetDef.listSubscribers} options. */
  export interface ListSubscribersOptions {
    /** If true, emit `.count>1` entry as multiple entries. */
    expandCount?: boolean;
  }

  /** Information about a subscriber. */
  export interface Subscriber extends SetRequired<N.Subscriber, "count" | "k" | "opc" | "subscribedNSSAI" | "gnbs"> {
    /**
     * Last SUPI (inclusive).
     *
     * @remarks
     * This would be same as `.supi` if `.count==1`.
     */
    supiLast: string;

    /** Subscribed Data Networks, derived from `.subscribedNSSAI`. */
    subscribedDN: N.DataNetworkID[];

    /** Requested Data Networks, derived from `.requestedNSSAI`. */
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

  /** Split S-NSSAI as sst and sd. */
  export function splitSNSSAI(snssai: N.SNSSAI): SNSSAI {
    assert(/^[\da-f]{2}(?:[\da-f]{6})?$/i.test(snssai));
    if (snssai.length === 2) {
      const sstInt = Number.parseInt(snssai, 16);
      return {
        hex: { sst: snssai },
        int: { sst: sstInt },
        ih: { sst: sstInt },
      };
    }
    const sst = snssai.slice(0, 2);
    const sstInt = Number.parseInt(sst, 16);
    const sd = snssai.slice(2);
    return {
      hex: { sst, sd },
      int: { sst: sstInt, sd: Number.parseInt(sd, 16) },
      ih: { sst: sstInt, sd },
    };
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
