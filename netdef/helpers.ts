import { randomBytes } from "node:crypto";

import map from "obliterator/map.js";
import type { Except, RequiredDeep, SetRequired } from "type-fest";
import { arr2hex } from "uint8-util";

import type { N } from "../types/mod.js";
import netdefSchema from "../types/netdef.schema.json";
import { assert, decPad, findByName, hexPad, makeSchemaValidator, type YargsInfer, type YargsOptions } from "../util/mod.js";

/** Validate NetDef object against JSON schema. */
export const validate: (input: unknown) => asserts input is N.Network = makeSchemaValidator<N.Network>(netdefSchema);

/** PLMN components. */
export interface PLMN {
  mcc: string;
  mnc: string;
}
export namespace PLMN {
  export interface Int {
    mcc: number;
    mnc: number;
    mncLength: 2 | 3;
  }
}

/** Split PLMN to MCC and MNC strings. */
export function splitPLMN(plmn: N.PLMN): PLMN;

/** Split PLMN to MCC and MNC integers. */
export function splitPLMN(plmn: N.PLMN, int: true): PLMN.Int;

export function splitPLMN(plmn: N.PLMN, int = false) {
  assert(/^\d{3}-\d{2,3}$/.test(plmn));
  const [mcc, mnc] = plmn.split("-") as [string, string];
  if (int) {
    return {
      mcc: Number.parseInt(mcc, 10),
      mnc: Number.parseInt(mnc, 10),
      mncLength: mnc.length as 2 | 3,
    };
  }
  return { mcc, mnc };
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

/** Split S-NSSAI as sst and sd. */
export function splitSNSSAI(snssai: N.SNSSAI, sdFilled?: boolean): SNSSAI;

/** Split S-NSSAI as sst and sd, filling default sd 0xFFFFFF. */
export function splitSNSSAI(snssai: N.SNSSAI, sdFilled: true): RequiredDeep<SNSSAI>;

export function splitSNSSAI(snssai: N.SNSSAI, sdFilled = false) {
  assert(/^[\da-f]{2}(?:[\da-f]{6})?$/i.test(snssai));
  if (snssai.length === 2 && !sdFilled) {
    const sstInt = Number.parseInt(snssai, 16);
    return {
      hex: { sst: snssai },
      int: { sst: sstInt },
      ih: { sst: sstInt },
    };
  }
  const sst = snssai.slice(0, 2);
  const sstInt = Number.parseInt(sst, 16);
  const sd = snssai.slice(2) || "FFFFFF";
  return {
    hex: { sst, sd },
    int: { sst: sstInt, sd: Number.parseInt(sd, 16) },
    ih: { sst: sstInt, sd },
  };
}

/** List all unique S-NSSAIs. */
export function listNssai({ dataNetworks }: N.Network): Iterable<N.SNSSAI> {
  return new Set(map(dataNetworks, ({ snssai }) => snssai));
}

export interface AMBR {
  downlink: `${number} Mbps`;
  uplink: `${number} Mbps`;
}

function toAmbr({ dlAmbr, ulAmbr }: { dlAmbr: number; ulAmbr: number }): AMBR {
  return {
    downlink: `${dlAmbr} Mbps`,
    uplink: `${ulAmbr} Mbps`,
  } as const;
}

/** Information about a subscriber. */
export interface Subscriber extends SetRequired<N.Subscriber, "count" | "k" | "opc" | "subscribedNSSAI" | "dlAmbr" | "ulAmbr" | "gnbs"> {
  /** Subscribed Data Networks, derived from `.subscribedNSSAI`. */
  subscribedDN: N.DataNetworkID[];

  /** Requested Data Networks, derived from `.requestedNSSAI`. */
  requestedDN: N.DataNetworkID[];

  /** Subscribed UE AMBR. */
  readonly ambr: AMBR;

  /** List of SUPIs, will have multiple entries if `.count>1`. */
  readonly supis: readonly string[];
}

/**
 * Iterate over subscribers.
 * @param expandCount - If true, emit each `.count>1` entry as multiple entries.
 */
export function listSubscribers(
    network: N.Network,
    { expandCount = true, singleDn, gnb }: listSubscribers.Options = {},
): Subscriber[] {
  const list: Subscriber[] = [];
  for (const sub of listSubscribersUnexpanded(network, gnb)) {
    if (!expandCount) {
      list.push(sub);
      continue;
    }

    let supiN = BigInt(sub.supi);
    for (let i = 0; i < sub.count; ++i) {
      const supi = decPad(supiN++, 15);
      list.push({ ...sub, supi, count: 1 });
    }
  }
  if (singleDn) {
    listSubscribersReduceToSingleDn(list, singleDn);
  }
  return list;
}
export namespace listSubscribers {
  /** {@link listSubscribers} options. */
  export interface Options {
    /**
     * If true, emit `.count>1` entry as multiple entries.
     * @defaultValue true
     */
    expandCount?: boolean;

    /**
     * Criteria to choose a singular requestedDN.
     *
     * @remarks
     * If a UE simulator only supports one requestedDN, it should accept
     * {@link subscriberSingleDnOptions} flag and pass its value as this option. When requested,
     * {@link Subscriber.requestedDN} has no more than one Data Network, which is chosen as:
     * - "first" chooses the first requestedDN.
     * - "last" chooses the last requestedDN.
     * - "rotate" chooses the i-th requestedDN, where i is incremented successively.
     */
    singleDn?: SubscriberSingleDnOpt["ue-single-dn"];

    /** If specified, emit subscribers connected to this gNB only. */
    gnb?: string;
  }
}

function* listSubscribersUnexpanded(network: N.Network, gnb: listSubscribers.Options["gnb"]): Iterable<Subscriber> {
  network.subscriberDefault ??= {};
  network.subscriberDefault.k ??= arr2hex(randomBytes(16));
  network.subscriberDefault.opc ??= arr2hex(randomBytes(16));

  const dfltSubscribedNSSAI: N.SubscriberSNSSAI[] = Array.from(
    Map.groupBy(network.dataNetworks, ({ snssai }) => snssai),
    ([snssai, dns]) => ({ snssai, dnns: dns.map(({ dnn }) => dnn) }),
  );
  const allGNBs = network.gnbs.map((gnb) => gnb.name);

  for (const subscriber of network.subscribers) {
    const sub: Subscriber = {
      count: 1,
      k: network.subscriberDefault.k,
      opc: network.subscriberDefault.opc,
      subscribedNSSAI: dfltSubscribedNSSAI,
      dlAmbr: 1000,
      ulAmbr: 1000,
      gnbs: allGNBs,
      ...subscriber,
      subscribedDN: [],
      requestedDN: [],

      get ambr() {
        return toAmbr(this);
      },
      get supis() {
        const { supi, count } = this;
        let n = BigInt(supi);
        return Array.from({ length: count }, () => decPad(n++, 15));
      },
    };
    assert(sub.count >= 1);

    if (gnb !== undefined && !sub.gnbs.includes(gnb)) {
      continue;
    }

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

    yield sub;
  }
}

export const subscriberSingleDnOptions = {
  "ue-single-dn": {
    array: false,
    choices: ["first", "last", "rotate"],
    default: "first",
    desc: "criteria to choose a singular requestedDN",
    type: "string",
  },
} as const satisfies YargsOptions;
export type SubscriberSingleDnOpt = YargsInfer<typeof subscriberSingleDnOptions>;

function listSubscribersReduceToSingleDn(
    list: readonly Subscriber[],
    singleDn: Exclude<listSubscribers.Options["singleDn"], undefined>,
): void {
  for (const [i, sub] of list.entries()) {
    const { requestedDN } = sub;
    if (requestedDN.length <= 1) {
      continue;
    }

    let index: number;
    switch (singleDn) {
      case "first": {
        index = 0;
        break;
      }
      case "last": {
        index = -1;
        break;
      }
      case "rotate": {
        index = i % requestedDN.length;
        break;
      }
    }
    sub.requestedDN = [requestedDN[index]!];
  }
}

/** Information about a gNB. */
export type GNB = N.GNB & {
  nci: GNB.NCI;
};
export namespace GNB {
  /** NR Cell Identity components. */
  export interface NCI {
    gnb: number;
    cell: number;
    nci: number;
  }
}

/** List all gNBs. */
export function listGnbs({ gnbs, gnbIdLength }: N.Network): GNB[] {
  return gnbs.map((gnb, i) => {
    const {
      nci = hexPad(((1 + i) << (36 - gnbIdLength)) | 0xF, 9),
    } = gnb;
    return {
      ...gnb,
      nci: Object.assign(nci, splitNCI(nci, gnbIdLength)),
    };
  });
}

/** Split NR Cell Identity (NCI) as gNB ID and Cell ID. */
function splitNCI(nci: string, gnbIdLength: number): GNB.NCI {
  assert(/^[\da-f]{9}$/i.test(nci));
  const n = BigInt(Number.parseInt(nci, 16));
  const cellIdLength = BigInt(36 - gnbIdLength);
  return {
    gnb: Number(n >> cellIdLength),
    cell: Number(n & ((1n << cellIdLength) - 1n)),
    nci: Number(n),
  };
}

/** Ensure 1-1 mapping between gNB and UE, to satisfy restriction of RAN simulators. */
export function* pairGnbUe(
    network: N.Network,
    { allowMultiUE = false, ...listSubscribersOpts }: pairGnbUe.Options = {},
): Iterable<[gnb: GNB, sub: Subscriber]> {
  const gnbs = new Map<string, GNB>();
  for (const gnb of listGnbs(network)) {
    gnbs.set(gnb.name, gnb);
  }

  for (const sub of listSubscribers(network, { ...listSubscribersOpts, expandCount: !allowMultiUE })) {
    assert(sub.gnbs.length === 1, `${sub.supi} must connect to exactly one gNB`);
    const gnb = gnbs.get(sub.gnbs[0]!);
    gnbs.delete(sub.gnbs[0]!);
    assert(gnb !== undefined, `${sub.gnbs[0]} must serve exactly one UE`);
    yield [gnb, sub];
  }
}
export namespace pairGnbUe {
  export interface Options extends Except<listSubscribers.Options, "expandCount"> {
    /**
     * Allow multiple UEs if they have consecutive SUPIs.
     * @defaultValue false
     */
    allowMultiUE?: boolean;
  }
}

/** Information about an AMF. */
export interface AMF extends Required<N.AMF> {}

/** List all AMFs. */
export function listAmfs(network: N.Network): AMF[] {
  let { amfs = [] } = network;
  if (amfs.length === 0) {
    amfs = [{ name: "amf" }];
  }

  const nssai = Array.from(listNssai(network));
  return amfs.map((amf, i) => {
    const result: AMF = {
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

/** Information about an SMF. */
export interface SMF extends Required<N.SMF> {}

/** List all SMFs. */
export function listSmfs(network: N.Network): SMF[] {
  let { smfs = [] } = network;
  if (smfs.length === 0) {
    smfs = [{ name: "smf" }];
  }

  const nssai = Array.from(listNssai(network));
  return smfs.map((smf, i) => ({
    name: `smf${i}`,
    nssai,
    ...smf,
  }));
}

/** Information about a Data Network. */
export interface DataNetwork extends SetRequired<N.DataNetwork, Exclude<keyof N.DataNetwork, "subnet">> {
  readonly index: number;
  readonly sessionType: Uppercase<N.DataNetworkType>;
  readonly ambr: AMBR;
}

/** Find Data Network by dnn and optional snssai. */
export function findDN(network: N.Network, dnn: string, snssai?: string): DataNetwork;
export function findDN(network: N.Network, id: N.DataNetworkID): DataNetwork;
export function findDN(network: N.Network, dnn: N.DataNetworkID | string, snssai?: string): DataNetwork {
  if (typeof dnn !== "string") {
    return findDN(network, dnn.dnn, dnn.snssai);
  }

  const index = network.dataNetworks.findIndex((dn) => dn.dnn === dnn && (snssai === undefined || dn.snssai === snssai));
  assert(index !== -1, `Data Network ${dnn} with S-NSSAI ${snssai} not found`);
  const dn = network.dataNetworks[index]!;
  assert(!dn.type.startsWith("IP") || dn.subnet, `Data Network ${dnn} is IP but has no subnet`);

  return {
    index,
    fiveQi: 9,
    fiveQiPriorityLevel: 90,
    arpLevel: 8,
    dlAmbr: 1000,
    ulAmbr: 1000,
    ...dn,

    get sessionType() {
      return this.type.toUpperCase() as Uppercase<N.DataNetworkType>;
    },
    get ambr() {
      return toAmbr(this);
    },
  };
}

/** Determine equality of two DataPathNodes. */
function equalDataPathNode(a: N.DataPathNode, b: N.DataPathNode): boolean {
  if (typeof a === "string" && typeof b === "string") {
    return a === b;
  }
  if (typeof a === "object" && typeof b === "object") {
    return a.snssai === b.snssai && a.dnn === b.dnn;
  }
  return false;
}

/** Iterate over peers of a data path node. */
export function* listDataPathPeers({ dataPaths }: N.Network, self: N.DataPathNode): Iterable<[peer: N.DataPathNode, cost: number]> {
  for (const [a, b, cost = 1] of dataPaths) {
    if (equalDataPathNode(self, a)) {
      yield [b, cost];
    } else if (equalDataPathNode(self, b)) {
      yield [a, cost];
    }
  }
}
export namespace listDataPathPeers {
  /**
   * Find UPFs adjacent to every gNB.
   * @throws Error if gNBs are connected to different sets of UPFs.
   */
  export function ofGnbs(network: N.Network): Iterable<[peer: string, cost: number]> {
    let peers: Map<string, number> | undefined;
    for (const gnb of network.gnbs) {
      if (!peers) {
        peers = new Map();
        for (const [upf, cost] of listDataPathPeers(network, gnb.name)) {
          peers.set(upf as string, cost);
        }
        continue;
      }

      const myPeers = new Set<string>();
      for (const [upf] of listDataPathPeers(network, gnb.name)) {
        myPeers.add(upf as string);
      }
      assert(
        myPeers.size === peers.size && myPeers.isSubsetOf(peers),
        `${gnb.name} has different N3 peers than other gNBs`,
      );
    }
    assert(peers, "no gNB");
    return peers;
  }
}

/** Information about a UPF. */
export interface UPF extends N.UPF {
  peers: UPF.Peers;
  /** N4/N6/N3/N9 networks. */
  nets: readonly string[];
}
export namespace UPF {
  export interface Peers {
    N3: GNB[];
    N9: N.UPF[];
    N6Ethernet: N6Peer[];
    N6IPv4: N6Peer[];
    N6IPv6: N6Peer[];
  }

  export interface N6Peer extends DataNetwork {
    cost: number;
  }
}

/** List all UPFs. */
export function listUpfs(network: N.Network): UPF[] {
  return Array.from(network.upfs, (upf) => {
    const peers = gatherUPFPeers(network, upf);
    const nets = ["n4"];
    if (peers.N6Ethernet.length + peers.N6IPv4.length + peers.N6IPv6.length > 0) {
      nets.push("n6");
    }
    if (peers.N3.length > 0) {
      nets.push("n3");
    }
    if (peers.N9.length > 0) {
      nets.push("n9");
    }
    return { ...upf, peers, nets };
  });
}

/** Gather N3,N9,N6 peers of a UPF. */
function gatherUPFPeers(network: N.Network, upf: N.UPF): UPF.Peers {
  const peers: UPF.Peers = {
    N3: [],
    N9: [],
    N6Ethernet: [],
    N6IPv4: [],
    N6IPv6: [],
  };

  let gnbs: GNB[] | undefined;
  for (const [peer, cost] of listDataPathPeers(network, upf.name)) {
    if (typeof peer === "string") {
      const gnb = findByName(peer, gnbs ??= listGnbs(network));
      if (gnb) {
        peers.N3.push(gnb);
        continue;
      }

      const upf = findByName(peer, network.upfs);
      if (upf) {
        peers.N9.push(upf);
        continue;
      }

      assert(false, `missing peer ${peer}`);
    }

    const dn = findDN(network, peer);
    peers[`N6${dn.type}`].push({ ...dn, cost });
  }

  return peers;
}
